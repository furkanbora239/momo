import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeMirror } from "../../features/tui-sidebar/mirror-io"
import { registerSidebarV2 } from "./sidebar-v2"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  type FakeSolidNode,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OCX_PROFILE: string | undefined
  readonly OMO_PROFILE: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
  readonly XDG_DATA_HOME: string | undefined
}

const ENV_KEYS = ["HOME", "OCX_PROFILE", "OMO_PROFILE", "OPENCODE_CONFIG_DIR", "XDG_DATA_HOME"] as const

const originalEnv: EnvSnapshot = {
  HOME: process.env.HOME,
  OCX_PROFILE: process.env.OCX_PROFILE,
  OMO_PROFILE: process.env.OMO_PROFILE,
  OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-v2-tui-sidebar-${label}-`))
  tempDirs.push(dir)
  return dir
}

function isolateEnv(home: string, dataHome: string): void {
  process.env.HOME = home
  process.env.XDG_DATA_HOME = dataHome
  delete process.env.OCX_PROFILE
  delete process.env.OMO_PROFILE
  delete process.env.OPENCODE_CONFIG_DIR
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function findTextContent(node: FakeSolidNode, needle: string): boolean {
  if (typeof node.props.content === "string" && node.props.content.includes(needle)) {
    return true
  }
  for (const child of node.children) {
    if (typeof child === "string" && child.includes(needle)) {
      return true
    }
    if (child !== null && typeof child === "object" && "props" in child) {
      if (findTextContent(child as FakeSolidNode, needle)) return true
    }
  }
  return false
}

type SidebarClaim = {
  readonly append: string
  readonly render: (input: { readonly sessionID: string }) => unknown
}

beforeEach(() => {
  tempDirs.length = 0
})

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  restoreEnv()
})

describe("#given an enabled sidebar config and a live mirror", () => {
  it("#when registering the sidebar #then a sidebar.content slot claim renders the snapshot view", async () => {
    const home = makeTempDir("home")
    const dataHome = makeTempDir("data")
    const project = makeTempDir("project")
    isolateEnv(home, dataHome)
    writeMirror(project, {
      version: 1,
      projectDir: project,
      updatedAt: Date.now(),
      activeAgents: [{ name: "sisyphus", status: "running" }],
      jobBoard: [
        {
          title: "Index repository",
          status: "running",
          toolCalls: 2,
          lastTool: "grep",
        },
      ],
      loop: null,
    })

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    await registerSidebarV2(fake.ctx, facade, solid)

    expect(fake.slotClaims).toHaveLength(1)
    const claim = fake.slotClaims[0]?.claim as unknown as SidebarClaim
    expect(claim.append).toBe("sidebar.content")

    const rendered = claim.render({ sessionID: "sess-1" }) as FakeSolidNode
    expect(rendered.tag).toBe("box")
    expect(rendered.props.flexDirection).toBe("column")
    expect(findTextContent(rendered, "sisyphus")).toBe(true)
    expect(findTextContent(rendered, "Index repository")).toBe(true)
    expect(fake.renderRequests).toBe(1)
  })
})

describe("#given a disabled sidebar config", () => {
  it("#when registering the sidebar #then no slot claim is registered", async () => {
    const home = makeTempDir("home-disabled")
    const dataHome = makeTempDir("data-disabled")
    const project = makeTempDir("project-disabled")
    isolateEnv(home, dataHome)
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(
      join(project, ".omo", "omo.jsonc"),
      JSON.stringify({ tui: { sidebar: { enabled: false } } }),
    )

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    await registerSidebarV2(fake.ctx, facade, solid)

    expect(fake.slotClaims).toHaveLength(0)
    expect(fake.renderRequests).toBe(0)
  })
})

describe("#given a registered sidebar", () => {
  it("#when the facade cleanup runs #then the slot claim is unregistered", async () => {
    const home = makeTempDir("home-cleanup")
    const dataHome = makeTempDir("data-cleanup")
    const project = makeTempDir("project-cleanup")
    isolateEnv(home, dataHome)

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    await registerSidebarV2(fake.ctx, facade, solid)
    facade.runCleanups()

    expect(fake.slotClaims).toHaveLength(1)
    expect(fake.slotClaims[0]?.unregistered).toBe(true)
  })
})
