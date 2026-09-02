import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

function mockLocalMcps(): void {
  mock.module("../lsp", () => ({
    createLspMcpConfig: () => ({ type: "local", command: ["node", "dist/cli.js", "mcp"], enabled: true }),
  }))
  mock.module("../codegraph", () => ({
    createCodegraphMcpConfig: () => ({ type: "local", command: ["codegraph", "serve", "--mcp"], enabled: true }),
  }))
}

describe("createBuiltinMcps", () => {
  test("registers only local MCPs when remote MCP config is omitted", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const disabledMcps: string[] = []

    // when
    const result = createBuiltinMcps(disabledMcps)

    // then
    expect(Object.keys(result).sort()).toEqual(["catalog", "codegraph", "lsp"])
    expect(result.websearch).toBeUndefined()
    expect(result.context7).toBeUndefined()
    expect(result.grep_app).toBeUndefined()
  })

  test("registers remote MCPs when their enabled flags are set", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const config = {
      websearch: { enabled: true },
      context7: { enabled: true },
      grep_app: { enabled: true },
    }

    // when
    const result = createBuiltinMcps([], config)

    // then
    expect(result.websearch).toBeDefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
    expect(result.lsp).toBeDefined()
    expect(result.codegraph).toBeDefined()
    expect(result.catalog).toBeDefined()
  })

  test("omits a remote MCP listed in disabled_mcps even when its enabled flag is set", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const config = {
      websearch: { enabled: true },
      context7: { enabled: true },
      grep_app: { enabled: true },
    }

    // when
    const result = createBuiltinMcps(["websearch"], config)

    // then
    expect(result.websearch).toBeUndefined()
    expect(result.context7).toBeDefined()
    expect(result.grep_app).toBeDefined()
  })

  test("should keep lsp when it uses a bootstrap command", () => {
    // given
    mock.module("../lsp", () => ({
      createLspMcpConfig: () => ({ type: "local", command: ["node", "-e", "bootstrap", "/repo"], enabled: true }),
    }))
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([])

    // then
    expect(result.lsp).toBeDefined()
  })

  test("should return empty array when all MCPs are disabled", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")
    const disabledMcps = ["websearch", "context7", "grep_app", "lsp", "codegraph", "catalog"]
    const config = {
      websearch: { enabled: true },
      context7: { enabled: true },
      grep_app: { enabled: true },
    }

    // when
    const result = createBuiltinMcps(disabledMcps, config)

    // then
    const remainingMcpNames = Object.keys(result)
    expect(remainingMcpNames).not.toContain("websearch")
    expect(remainingMcpNames).not.toContain("context7")
    expect(remainingMcpNames).not.toContain("grep_app")
    expect(remainingMcpNames).not.toContain("lsp")
    expect(remainingMcpNames).not.toContain("codegraph")
    expect(remainingMcpNames).not.toContain("catalog")
    expect(remainingMcpNames).toEqual([])
  })

  test("should register catalog as a local MCP when enabled", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([])

    // then
    expect(result.catalog).toBeDefined()
    expect(result.catalog?.type).toBe("local")
    expect(result.catalog?.environment?.OMO_CATALOG_CACHE_FILE).toContain("provider-models.json")
  })

  test("should pass catalog prefer_providers through to the catalog MCP environment", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([], { catalog: { prefer_providers: ["neuralwatt"] } })

    // then
    expect(result.catalog?.environment?.OMO_CATALOG_PREFER_PROVIDERS).toBe("neuralwatt")
  })

  test("should default the catalog provider boost env to neutral when unconfigured", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([], { catalog: {} })

    // then
    expect(result.catalog?.environment?.OMO_CATALOG_PREFER_PROVIDERS).toBe("")
  })

  test("should omit catalog when listed in disabled_mcps", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps(["catalog"])

    // then
    expect(result.catalog).toBeUndefined()
  })

  test("should omit codegraph when its config section is disabled", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps([], { codegraph: { enabled: false } })

    // then
    expect(result.codegraph).toBeUndefined()
  })

  test("should omit codegraph when it is listed in disabled_mcps", () => {
    // given
    mockLocalMcps()
    const { createBuiltinMcps } = require("../index") as typeof import("../index")

    // when
    const result = createBuiltinMcps(["codegraph"], { codegraph: { enabled: true } })

    // then
    expect(result.codegraph).toBeUndefined()
  })

  test("should keep codegraph registered but disabled when its binary is absent", async () => {
    // given
    mock.restore()
    const { createBuiltinMcps } = await import(`../index?codegraph-missing=${Date.now()}-${Math.random()}`)

    // when
    const result = createBuiltinMcps([], { codegraph: { enabled: true } }, {
      codegraph: {
        fileExists: () => false,
        homeDir: "/tmp/omo-codegraph-missing-home",
      },
      cwd: process.cwd(),
      resolveExecutable: (commandName: string) => ({ command: commandName, available: false }),
    })

    // then
    expect(result.codegraph?.type).toBe("local")
    expect(result.codegraph?.enabled).toBe(false)
  })

  test("should resolve enabled local MCP runtime commands before registration", async () => {
    // given
    mock.restore()
    const nodePath = "/tmp/omo-runtime/node"
    const bunPath = "/tmp/omo-runtime/bun"
    const { createBuiltinMcps } = await import(`../index?runtime=${Date.now()}-${Math.random()}`)

    // when
    const result = createBuiltinMcps([], undefined, {
      cwd: process.cwd(),
      resolveExecutable: (commandName: string) => {
        if (commandName === "node") return { command: nodePath, available: true }
        if (commandName === "bun") return { command: bunPath, available: true }
        return { command: commandName, available: false }
      },
    })

    // then
    expect(result.lsp?.type).toBe("local")
    if (result.lsp?.type !== "local") throw new Error("expected local MCP config")
    expect(["node", "bun"]).not.toContain(result.lsp.command[0])
    expect([nodePath, bunPath]).toContain(result.lsp.command[0])
  })
})
