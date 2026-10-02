import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeMirror } from "../../features/tui-sidebar/mirror-io"
import { registerSubagentTreeV2 } from "./subagent-tree-v2"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  flushTimeoutZero,
  type FakeSolidNode,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

const CARD_MODE = "omo.tui-card.tasks"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly XDG_DATA_HOME: string | undefined
}

const originalEnv: EnvSnapshot = {
  HOME: process.env.HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-v2-tui-tasks-${label}-`))
  tempDirs.push(dir)
  return dir
}

function findTextContent(node: FakeSolidNode, needle: string): boolean {
  if (typeof node.props.content === "string" && node.props.content.includes(needle)) {
    return true
  }
  for (const child of node.children) {
    if (child !== null && typeof child === "object" && "props" in child) {
      if (findTextContent(child as FakeSolidNode, needle)) return true
    }
  }
  return false
}

function slashCommandOf(
  fake: ReturnType<typeof createFakeV2TuiContext>,
  id: string,
): { readonly slash?: { readonly name: string; readonly aliases?: readonly string[] }; readonly run: () => void } | undefined {
  for (const layer of fake.keymapLayers) {
    for (const command of layer().commands ?? []) {
      if (command.id === id) return command
    }
  }
  return undefined
}

function cardLayerCommands(
  fake: ReturnType<typeof createFakeV2TuiContext>,
): { readonly bind?: false | string; readonly run: (input?: string) => unknown }[] {
  for (const layer of fake.keymapLayers) {
    const resolved = layer()
    if (resolved.mode === CARD_MODE) return resolved.commands ?? []
  }
  return []
}

function runBound(
  fake: ReturnType<typeof createFakeV2TuiContext>,
  bind: string,
): void {
  for (const command of cardLayerCommands(fake)) {
    if (command.bind === bind) {
      command.run()
      return
    }
  }
  throw new Error(`no command bound to ${bind}`)
}

beforeEach(() => {
  tempDirs.length = 0
})

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (originalEnv.HOME === undefined) delete process.env.HOME
  else process.env.HOME = originalEnv.HOME
  if (originalEnv.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME
})

describe("#given a registered V2 subagent tree", () => {
  it("#when registration completes #then the tasks slash command and the card keymap layer are added", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    registerSubagentTreeV2(fake.ctx, facade, solid)

    const command = slashCommandOf(fake, "omo.subagent-tree.tasks")
    expect(command?.slash?.name).toBe("tasks")
    expect(command?.slash?.aliases).toEqual(["agents", "subagents"])
    expect(cardLayerCommands(fake).length).toBeGreaterThan(0)
  })

  it("#when the tasks command runs without a mirror #then a warning toast is shown", () => {
    const home = makeTempDir("home")
    const dataHome = makeTempDir("data")
    const project = makeTempDir("project")
    process.env.HOME = home
    process.env.XDG_DATA_HOME = dataHome

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerSubagentTreeV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.subagent-tree.tasks")?.run()

    expect(fake.toasts).toHaveLength(1)
    expect(fake.toasts[0]?.variant).toBe("warning")
    expect(fake.dialogShows).toHaveLength(0)
  })

  it("#when the tasks command runs with a live mirror #then the dialog renders the subagent cards", async () => {
    const home = makeTempDir("home-open")
    const dataHome = makeTempDir("data-open")
    const project = makeTempDir("project-open")
    process.env.HOME = home
    process.env.XDG_DATA_HOME = dataHome
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
          agent: "explore",
          sessionId: "sess-42",
          model: "provider/cheap",
        },
      ],
      loop: null,
    })

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerSubagentTreeV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.subagent-tree.tasks")?.run()
    await flushTimeoutZero()

    expect(fake.dialogShows).toHaveLength(1)
    expect(fake.dialogSizes).toEqual(["xlarge"])
    expect(fake.pushedModes).toEqual([CARD_MODE])
    const rendered = fake.dialogShows[0]?.render() as FakeSolidNode
    expect(findTextContent(rendered, "explore")).toBe(true)
    expect(findTextContent(rendered, "Index repository")).toBe(true)
  })

  it("#when enter activates a focused card with a session id #then the prompt detail select is shown", async () => {
    const home = makeTempDir("home-detail")
    const dataHome = makeTempDir("data-detail")
    const project = makeTempDir("project-detail")
    process.env.HOME = home
    process.env.XDG_DATA_HOME = dataHome
    writeMirror(project, {
      version: 1,
      projectDir: project,
      updatedAt: Date.now(),
      activeAgents: [{ name: "sisyphus", status: "running" }],
      jobBoard: [
        {
          title: "Index repository",
          status: "running",
          toolCalls: 0,
          lastTool: null,
          agent: "explore",
          sessionId: "sess-42",
        },
      ],
      loop: null,
    })

    const fake = createFakeV2TuiContext({
      directory: project,
      messages: [{ type: "user", text: "the orchestrator prompt" }],
    })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerSubagentTreeV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.subagent-tree.tasks")?.run()
    await flushTimeoutZero()
    runBound(fake, "enter")
    await flushTimeoutZero()

    expect(fake.dialogSelects).toHaveLength(1)
    const options = fake.dialogSelects[0]?.options ?? []
    expect(options.some((option) => option.title === "the orchestrator prompt")).toBe(true)
  })

  it("#when the facade cleanup runs #then polling stops without errors", async () => {
    const home = makeTempDir("home-cleanup")
    const dataHome = makeTempDir("data-cleanup")
    const project = makeTempDir("project-cleanup")
    process.env.HOME = home
    process.env.XDG_DATA_HOME = dataHome

    const fake = createFakeV2TuiContext({ directory: project })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerSubagentTreeV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.subagent-tree.tasks")?.run()
    await flushTimeoutZero()
    facade.runCleanups()

    expect(fake.dialogShows).toHaveLength(0)
    expect(fake.toasts).toHaveLength(1)
  })
})
