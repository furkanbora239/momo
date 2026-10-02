import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildAgentMarkdown,
  emitNewAgentFiles,
  resolveAgentEmissionDirectory,
  toKebabFileStem,
  type NewAgentEntry,
} from "./agent-file-emitter"

const ORIGINAL_OPENCODE_CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR

afterEach(() => {
  if (ORIGINAL_OPENCODE_CONFIG_DIR === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR
  } else {
    process.env.OPENCODE_CONFIG_DIR = ORIGINAL_OPENCODE_CONFIG_DIR
  }
})

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "omo-agent-emitter-"))
}

const FULL_ENTRY: NewAgentEntry = {
  id: "fixture-agent",
  entry: {
    prompt: "fixture system prompt body",
    description: "fixture agent description",
    mode: "subagent",
    model: "prov-1/mod-1#fast",
    maxSteps: 12,
    color: "#123456",
    disable: true,
    temperature: 0.2,
    top_p: 0.9,
    permission: { edit: "allow", bash: { "rm *": "deny" } },
  },
}

describe("#given a full V1 agent entry", () => {
  it("#when buildAgentMarkdown is called then frontmatter carries the V2 fields and the body is the prompt", () => {
    const markdown = buildAgentMarkdown(FULL_ENTRY.id, FULL_ENTRY.entry)
    expect(markdown).toBe(
      [
        "---",
        'description: "fixture agent description"',
        "mode: subagent",
        'model: "prov-1/mod-1#fast"',
        "permissions:",
        "  - action: edit",
        '    resource: "*"',
        "    effect: allow",
        "  - action: shell",
        '    resource: "rm *"',
        "    effect: deny",
        "steps: 12",
        'color: "#123456"',
        "disabled: true",
        "request:",
        "  body:",
        "    temperature: 0.2",
        "    top_p: 0.9",
        "---",
        "",
        "fixture system prompt body",
        "",
      ].join("\n"),
    )
  })
})

describe("#given a minimal V1 agent entry", () => {
  it("#when buildAgentMarkdown is called then only the body is emitted", () => {
    const markdown = buildAgentMarkdown("fixture-agent", { prompt: "only a prompt" })
    expect(markdown).toBe("---\n---\n\nonly a prompt\n")
  })
})

describe("#given agent ids", () => {
  it("#when toKebabFileStem is called then ids normalize to kebab-case stems", () => {
    expect(toKebabFileStem("already-kebab")).toBe("already-kebab")
    expect(toKebabFileStem("OpenCode-Builder")).toBe("opencode-builder")
    expect(toKebabFileStem("fixture agent!!")).toBe("fixture-agent")
    expect(toKebabFileStem("")).toBe("agent")
  })
})

describe("#given a preferred directory", () => {
  it("#when resolveAgentEmissionDirectory is called then the preference wins", () => {
    expect(resolveAgentEmissionDirectory({ preferredDirectory: "/fixture/agents", fallbackRoot: "/fixture/project" })).toBe(
      "/fixture/agents",
    )
  })
})

describe("#given OPENCODE_CONFIG_DIR is set", () => {
  it("#when resolveAgentEmissionDirectory is called then the user-level agents dir is derived from it", () => {
    const root = createTempRoot()
    try {
      process.env.OPENCODE_CONFIG_DIR = root
      const resolved = resolveAgentEmissionDirectory({ fallbackRoot: "/fixture/project" })
      expect(resolved).toBe(join(root, "agents"))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("#given two new agents in a temp agents dir", () => {
  it("#when emitNewAgentFiles runs then one file per agent is written with the right content", async () => {
    const root = createTempRoot()
    try {
      const second: NewAgentEntry = {
        id: "Second Fixture",
        entry: { prompt: "second fixture prompt", mode: "all" },
      }
      const result = await emitNewAgentFiles([FULL_ENTRY, second], {
        preferredDirectory: root,
        fallbackRoot: root,
      })
      expect(result.emitted).toEqual(["fixture-agent", "Second Fixture"])
      expect(result.skipped).toEqual([])
      expect(result.directory).toBe(root)

      const first = readFileSync(join(root, "fixture-agent.md"), "utf-8")
      expect(first).toContain("fixture system prompt body")
      expect(first).toContain("description: \"fixture agent description\"")
      expect(first).toContain("model: \"prov-1/mod-1#fast\"")
      const secondFile = readFileSync(join(root, "second-fixture.md"), "utf-8")
      expect(secondFile).toBe("---\nmode: all\n---\n\nsecond fixture prompt\n")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#when emitNewAgentFiles runs twice then existing files are never overwritten", async () => {
    const root = createTempRoot()
    try {
      await emitNewAgentFiles([FULL_ENTRY], { preferredDirectory: root, fallbackRoot: root })
      const before = readFileSync(join(root, "fixture-agent.md"), "utf-8")
      const second = await emitNewAgentFiles(
        [{ id: "fixture-agent", entry: { prompt: "changed fixture prompt" } }],
        { preferredDirectory: root, fallbackRoot: root },
      )
      expect(second.emitted).toEqual([])
      expect(second.skipped).toEqual(["fixture-agent"])
      expect(readFileSync(join(root, "fixture-agent.md"), "utf-8")).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#when the agents list is empty then no directory is created", async () => {
    const root = createTempRoot()
    try {
      const target = join(root, "agents")
      const result = await emitNewAgentFiles([], { preferredDirectory: target, fallbackRoot: root })
      expect(result.emitted).toEqual([])
      expect(existsSync(target)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("#when the preferred directory does not exist then it is created", async () => {
    const root = createTempRoot()
    try {
      const target = join(root, "nested", "agents")
      await emitNewAgentFiles([FULL_ENTRY], { preferredDirectory: target, fallbackRoot: root })
      expect(existsSync(join(target, "fixture-agent.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("#given an unwritable user-level dir with a project fallback", () => {
  it("#when emitNewAgentFiles runs then the project fallback receives the files", async () => {
    const root = createTempRoot()
    try {
      const blocker = join(root, "blocker")
      mkdirSync(root, { recursive: true })
      writeFileSync(blocker, "not a directory", "utf-8")
      process.env.OPENCODE_CONFIG_DIR = join(blocker, "sub")
      const projectRoot = join(root, "project")
      mkdirSync(projectRoot, { recursive: true })
      const result = await emitNewAgentFiles([FULL_ENTRY], { fallbackRoot: projectRoot })
      expect(result.directory).toBe(join(projectRoot, ".opencode", "agents"))
      expect(result.emitted).toEqual(["fixture-agent"])
      expect(existsSync(join(result.directory, "fixture-agent.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
