import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "bun:test"

import { createTransformHooks } from "../../plugin/hooks/create-transform-hooks"
import { createMessagesTransformHandler } from "../../plugin/messages-transform"
import type { PluginContext } from "../../plugin/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createFixtureProject } from "./test-fixtures/fixture"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
}

type TransformMessage = {
  info: { id: string; role: string; sessionID?: string }
  parts: TransformPart[]
}

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-map-wiring-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createCtx(directory: string, client: Record<string, unknown>): PluginContext {
  return unsafeTestValue({ directory, client })
}

function createUserMessage(sessionID: string, text: string): TransformMessage {
  return {
    info: { id: `msg_${sessionID}`, role: "user", sessionID },
    parts: [{ type: "text", text }],
  }
}

describe("repo map injector through the transform wiring", () => {
  it("#given repo_map enabled and a fixture index #when the messages transform handler runs #then the map is injected once per session", async () => {
    // given
    const projectRoot = makeTempDir()
    createFixtureProject(projectRoot)
    const transformHooks = createTransformHooks({
      ctx: createCtx(projectRoot, {}),
      pluginConfig: unsafeTestValue({ repo_map: { enabled: true, token_budget: 1536, rank: "centrality" } }),
      isHookEnabled: () => true,
    })
    expect(transformHooks.repoMapInjector).not.toBeNull()
    const handler = createMessagesTransformHandler({
      hooks: unsafeTestValue({ repoMapInjector: transformHooks.repoMapInjector }),
    })

    // when
    const output = {
      messages: [createUserMessage("ses_a", "explain the layout")],
    }
    await handler({}, unsafeTestValue(output))
    await handler({}, unsafeTestValue(output))

    // then
    const maps = output.messages
      .flatMap((message) => message.parts)
      .filter((part) => part.synthetic === true && part.text?.startsWith("<repo_map>") === true)
    expect(maps).toHaveLength(1)
    expect(maps[0]?.text).toContain("hubFn")
  })

  it("#given repo_map disabled #when the transform hooks are composed #then no injector is registered and the transform is a no-op", async () => {
    // given
    const projectRoot = makeTempDir()
    createFixtureProject(projectRoot)
    const transformHooks = createTransformHooks({
      ctx: createCtx(projectRoot, {}),
      pluginConfig: unsafeTestValue({}),
      isHookEnabled: () => true,
    })
    expect(transformHooks.repoMapInjector).toBeNull()
    const handler = createMessagesTransformHandler({
      hooks: unsafeTestValue({ repoMapInjector: transformHooks.repoMapInjector }),
    })

    // when
    const output = {
      messages: [createUserMessage("ses_b", "explain the layout")],
    }
    await handler({}, unsafeTestValue(output))

    // then
    expect(output.messages[0]!.parts).toHaveLength(1)
  })

  it("#given repo_map enabled but no index #when the messages transform handler runs #then the output is unchanged", async () => {
    // given
    const projectRoot = makeTempDir()
    const transformHooks = createTransformHooks({
      ctx: createCtx(projectRoot, {}),
      pluginConfig: unsafeTestValue({ repo_map: { enabled: true, token_budget: 1536, rank: "centrality" } }),
      isHookEnabled: () => true,
    })
    const handler = createMessagesTransformHandler({
      hooks: unsafeTestValue({ repoMapInjector: transformHooks.repoMapInjector }),
    })

    // when
    const output = {
      messages: [createUserMessage("ses_c", "explain the layout")],
    }
    await handler({}, unsafeTestValue(output))

    // then
    expect(output.messages[0]!.parts).toHaveLength(1)
  })

  it("#given repo_map enabled and a fixture index #when the handler runs for a synthetic turn #then nothing is injected", async () => {
    // given
    const projectRoot = makeTempDir()
    createFixtureProject(projectRoot)
    const transformHooks = createTransformHooks({
      ctx: createCtx(projectRoot, {}),
      pluginConfig: unsafeTestValue({ repo_map: { enabled: true, token_budget: 1536, rank: "centrality" } }),
      isHookEnabled: () => true,
    })
    const handler = createMessagesTransformHandler({
      hooks: unsafeTestValue({ repoMapInjector: transformHooks.repoMapInjector }),
    })

    // when
    const output = {
      messages: [{ info: { id: "msg_syn", role: "user", sessionID: "ses_d" }, parts: [{ type: "text", text: "continue", synthetic: true }] }],
    }
    await handler({}, unsafeTestValue(output))

    // then
    expect(output.messages[0]!.parts).toHaveLength(1)
  })
})