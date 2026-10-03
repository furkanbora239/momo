import { describe, expect, it } from "bun:test"
import { tool } from "@opencode-ai/plugin/tool"
import type { ToolContext as V2ToolContext } from "@opencode/plugin/promise/tool"
import type { V2PluginContext } from "./types"
import { registerV2Tools } from "./tool-bridge"
import { buildV1Context, convertV1ToolDefinition, mapV1Result, resolveV1InputSchema } from "./tool-conversion"

type AddedTool = {
  name: string
  description: string
  input: unknown
  execute: (input: unknown, context: V2ToolContext) => Promise<unknown>
}

function createFakeCtx() {
  const added: AddedTool[] = []
  let transformCalls = 0
  const ctx = {
    tool: {
      transform: async (callback: (editor: { add: (tool: AddedTool) => void }) => void) => {
        transformCalls += 1
        callback({ add: (t) => added.push(t) })
        return { dispose: async () => {} }
      },
    },
  } as unknown as V2PluginContext
  return { ctx, added, getTransformCalls: () => transformCalls }
}

function createV2Context(): V2ToolContext {
  return {
    sessionID: "sess-1",
    agent: "agent-1",
    messageID: "msg-1",
    id: "call-1",
    signal: new AbortController().signal,
    progress: async () => {},
  }
}

describe("#given a V1 tool map with multiple tools", () => {
  it("#when registerV2Tools is called then every tool is added in a single transform call", async () => {
    const stringTool = tool({
      description: "fixture string tool",
      args: { q: tool.schema.string() },
      execute: async (args) => `ran ${args.q}`,
    })
    const objectTool = tool({
      description: "fixture object tool",
      args: { q: tool.schema.string() },
      execute: async (args) => ({ output: `out ${args.q}`, metadata: { n: 1 } }),
    })
    const { ctx, added, getTransformCalls } = createFakeCtx()

    await registerV2Tools(ctx, { string_tool: stringTool, object_tool: objectTool })

    expect(getTransformCalls()).toBe(1)
    expect(added).toHaveLength(2)
    expect(added[0].name).toBe("string_tool")
    expect(added[0].description).toBe("fixture string tool")
    expect(added[1].name).toBe("object_tool")
    expect(added[1].description).toBe("fixture object tool")
  })
})

describe("#given an undefined or empty tools map", () => {
  it("#when registerV2Tools is called then it is a no-op", async () => {
    const { ctx, added, getTransformCalls } = createFakeCtx()
    await registerV2Tools(ctx, undefined)
    await registerV2Tools(ctx, {})
    expect(getTransformCalls()).toBe(0)
    expect(added).toHaveLength(0)
  })
})

describe("#given a V1 tool with a zod schema", () => {
  it("#when convertV1ToolDefinition is called then the schema validates via the standard-schema protocol", async () => {
    const def = tool({
      description: "schema passthrough",
      args: { q: tool.schema.string(), n: tool.schema.number().optional() },
      execute: async () => "ok",
    })
    const info = convertV1ToolDefinition("schema_tool", def) as unknown as {
      input: { "~standard": { validate: (v: unknown) => { value?: unknown; issues?: unknown } } }
    }

    const ok = info.input["~standard"].validate({ q: "hello" })
    expect(ok.issues).toBeUndefined()
    expect(ok.value).toEqual({ q: "hello" })

    const bad = info.input["~standard"].validate({ q: 123 })
    expect(bad.issues).toBeDefined()
  })
})

describe("#given a V1 tool returning a string", () => {
  it("#when the converted execute runs then the result is wrapped as { content }", async () => {
    const def = tool({
      description: "string result",
      args: { q: tool.schema.string() },
      execute: async (args) => `ran ${args.q}`,
    })
    const info = convertV1ToolDefinition("string_tool", def)
    const result = (await info.execute({ q: "x" }, createV2Context())) as { content: string }
    expect(result).toEqual({ content: "ran x" })
  })
})

describe("#given a V1 tool returning an object", () => {
  it("#when the converted execute runs then output and metadata are wrapped", async () => {
    const def = tool({
      description: "object result",
      args: { q: tool.schema.string() },
      execute: async (args) => ({ output: `out ${args.q}`, metadata: { count: 2 } }),
    })
    const info = convertV1ToolDefinition("object_tool", def)
    const result = (await info.execute({ q: "y" }, createV2Context())) as {
      content: string
      metadata: { count: number }
    }
    expect(result.content).toBe("out y")
    expect(result.metadata).toEqual({ count: 2 })
  })
})

describe("#given the V2 execution context", () => {
  it("#when the converted execute runs then it adapts into the V1 context (sessionID/agent/messageID/abort=signal)", async () => {
    let captured: unknown
    const def = tool({
      description: "context capture",
      args: {},
      execute: async (_args, context) => {
        captured = context
        return "ok"
      },
    })
    const info = convertV1ToolDefinition("ctx_tool", def)
    const v2 = createV2Context()
    await info.execute({}, v2)
    const v1 = captured as {
      sessionID: string
      agent: string
      messageID: string
      abort: AbortSignal
    }
    expect(v1.sessionID).toBe("sess-1")
    expect(v1.agent).toBe("agent-1")
    expect(v1.messageID).toBe("msg-1")
    expect(v1.abort).toBe(v2.signal)
  })
})

describe("#given a V1 tool with no args", () => {
  it("#when resolveV1InputSchema is called then a permissive standard schema is returned", () => {
    const def = tool({
      description: "no args",
      args: {},
      execute: async () => "ok",
    })
    const schema = resolveV1InputSchema(def) as {
      "~standard": { validate: (v: unknown) => { value?: unknown; issues?: unknown } }
    }
    const ok = schema["~standard"].validate({ anything: 1 })
    expect(ok.issues).toBeUndefined()
    expect(ok.value).toEqual({ anything: 1 })
  })
})

describe("#given the V2 context", () => {
  it("#when buildV1Context is called then signal maps to abort and metadata bridges to progress", async () => {
    const progressUpdates: Array<Record<string, unknown>> = []
    const v2: V2ToolContext = {
      ...createV2Context(),
      progress: async (update) => {
        progressUpdates.push(update)
      },
    }
    const v1 = buildV1Context(v2)
    expect(v1.abort).toBe(v2.signal)
    v1.metadata({ title: "t", metadata: { k: "v" } })
    await new Promise((r) => setTimeout(r, 0))
    expect(progressUpdates).toEqual([{ title: "t", k: "v" }])
  })
})

describe("#given V1 tool results", () => {
  it("#when mapV1Result is called then strings and objects map correctly", () => {
    expect(mapV1Result("hello")).toEqual({ content: "hello" })
    expect(mapV1Result({ output: "body", metadata: { a: 1 } })).toEqual({
      content: "body",
      metadata: { a: 1 },
    })
    expect(mapV1Result({ text: "alt", metadata: { b: 2 } } as never)).toEqual({
      content: "alt",
      metadata: { b: 2 },
    })
  })
})
