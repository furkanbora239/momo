import { isRecord } from "@oh-my-opencode/utils"
import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V2RegistrationCollector } from "./registration-collector"
import { createLogOnce, createV1HookInvoker, createV1HookInvokerSync } from "./registration-collector"

/**
 * Bridges `tool.execute.before`, `tool.execute.after`, and `tool.definition`
 * onto the V2 tool domain.
 *
 * - `execute.before`: the V1 `output.args` view IS the mutable V2 `e.input`
 *   (same reference), so in-place mutations flow back; momo's
 *   `replaceToolArgs` swaps the reference, so a swapped object is copied key
 *   by key onto `e.input` after the handler returns.
 * - `execute.after` (completed): `output.output` flows back into
 *   `result.content` when it is a plain string; `output.metadata` merges into
 *   `result.metadata`; `output.title` has no V2 Tool.Result equivalent and
 *   degrades with a log-once. Error-status results only degrade their
 *   metadata (the V2 error object is consumed by the runtime).
 * - `tool.definition`: applied inside ONE replayable `ctx.tool.transform`
 *   callback; the V1 handler fires per listed tool with its synchronous
 *   portion applied immediately (see createV1HookInvokerSync) and mutations
 *   flow back via `editor.update`.
 */
export async function registerToolHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const logOnce = createLogOnce("v2-tool-hook-bridge")
  const invoke = createV1HookInvoker()
  const invokeSync = createV1HookInvokerSync(logOnce)

  collector.add(
    await ctx.tool.hook("execute.before", async (event) => {
      if (!isRecord(event.input)) {
        logOnce("before-non-record", "tool.execute.before input is not a record; V1 handler skipped", {
          tool: event.tool,
          callID: event.id,
        })
        return
      }
      const argsOutput = { args: event.input as Record<string, unknown> }
      await invoke(
        "tool.execute.before",
        hooks["tool.execute.before"],
        { tool: event.tool, sessionID: event.sessionID, callID: event.id },
        argsOutput,
      )
      if (argsOutput.args !== event.input) {
        copyArgsOntoEventInput(event.input, argsOutput.args)
      }
    }),
  )

  collector.add(
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status === "completed") {
        await bridgeExecuteAfterCompleted(invoke, hooks, logOnce, event)
        return
      }
      await bridgeExecuteAfterError(invoke, hooks, logOnce, event)
    }),
  )

  collector.add(
    await ctx.tool.transform((editor) => {
      for (const tool of editor.list()) {
        const output = { description: tool.description, parameters: tool.input as unknown }
        const descriptionBefore = output.description
        const parametersBefore = output.parameters
        invokeSync("tool.definition", hooks["tool.definition"], { toolID: tool.id }, output)
        if (output.description === descriptionBefore && output.parameters === parametersBefore) continue
        const nextDescription = output.description
        const nextParameters = output.parameters
        editor.update(tool.id, (editable) => {
          if (nextDescription !== descriptionBefore) editable.description = nextDescription
          if (nextParameters !== parametersBefore && isRecord(nextParameters)) {
            editable.input = nextParameters
          }
        })
      }
    }),
  )
}

function copyArgsOntoEventInput(target: Record<string, unknown>, replacement: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    if (key in replacement) continue
    delete target[key]
  }
  Object.assign(target, replacement)
}

type ExecuteAfterCompleted = {
  readonly tool: string
  readonly sessionID: string
  readonly id: string
  readonly input: unknown
  readonly status: "completed"
  result: { readonly content?: string | ReadonlyArray<unknown>; readonly metadata?: Readonly<Record<string, unknown>> }
}

type ExecuteAfterError = {
  readonly tool: string
  readonly sessionID: string
  readonly id: string
  readonly status: "error"
  error: { readonly message: string; readonly metadata?: Readonly<Record<string, unknown>> }
}

async function bridgeExecuteAfterCompleted(
  invoke: ReturnType<typeof createV1HookInvoker>,
  hooks: HooksWithRuntimeLifecycle,
  logOnce: ReturnType<typeof createLogOnce>,
  event: ExecuteAfterCompleted,
): Promise<void> {
  const resultView = event.result as { content?: string | ReadonlyArray<unknown>; metadata?: Record<string, unknown> }
  const initialOutput = joinResultContent(event.result)
  const output = {
    title: "",
    output: initialOutput,
    metadata: { ...(event.result.metadata ?? {}) },
  }
  await invoke(
    "tool.execute.after",
    hooks["tool.execute.after"],
    {
      tool: event.tool,
      sessionID: event.sessionID,
      callID: event.id,
      args: isRecord(event.input) ? event.input : undefined,
    },
    output,
  )
  if (typeof resultView.content === "string" && resultView.content !== output.output) {
    resultView.content = output.output
  } else if (typeof resultView.content !== "string" && output.output !== initialOutput) {
    logOnce(
      "after-content-shape",
      "tool.execute.after output mutation could not flow back into a non-string V2 result content; degraded",
      { tool: event.tool, callID: event.id },
    )
  }
  resultView.metadata = output.metadata
  if (output.title.length > 0) {
    logOnce("after-title", "tool.execute.after title mutation has no V2 Tool.Result equivalent; degraded", {
      tool: event.tool,
      callID: event.id,
    })
  }
}

async function bridgeExecuteAfterError(
  invoke: ReturnType<typeof createV1HookInvoker>,
  hooks: HooksWithRuntimeLifecycle,
  logOnce: ReturnType<typeof createLogOnce>,
  event: ExecuteAfterError,
): Promise<void> {
  const output = {
    title: "",
    output: event.error.message,
    metadata: { ...(event.error.metadata ?? {}) },
  }
  await invoke(
    "tool.execute.after",
    hooks["tool.execute.after"],
    {
      tool: event.tool,
      sessionID: event.sessionID,
      callID: event.id,
      args: undefined,
    },
    output,
  )
  if (output.output !== event.error.message) {
    logOnce(
      "after-error-output",
      "tool.execute.after output mutation on an errored tool call cannot flow back; degraded",
      { tool: event.tool, callID: event.id },
    )
  }
}

function joinResultContent(result: { readonly content?: string | ReadonlyArray<unknown> }): string {
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return (result.content as unknown[])
      .map((item) => (isRecord(item) && item["type"] === "text" && typeof item["text"] === "string" ? item["text"] : ""))
      .join("\n")
  }
  return ""
}
