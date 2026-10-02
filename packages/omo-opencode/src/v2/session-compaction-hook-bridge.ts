import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V2RegistrationCollector } from "./registration-collector"
import { createV1HookInvoker } from "./registration-collector"

/**
 * Bridges `experimental.session.compacting` onto `ctx.session.hook("compaction", ...)`.
 *
 * V1 output mapping (src/plugin/session-compacting.ts consumption):
 * - `context: string[]`: appended to the compaction prompt under V1; the V2
 *   SessionCompaction IS the compaction model request, so each string is
 *   appended as a text part onto the LAST user message of `e.messages`
 *   (mirroring "appended to the default prompt"). Degrades with a warn-once
 *   when the request carries no user message.
 * - `prompt?: string` (full prompt replacement): has no V2 equivalent;
 *   degrades with a warn-once.
 *
 * `experimental.compaction.autocontinue` has NO V2 equivalent and is dropped
 * with a single console.warn at registration time.
 */
export async function registerSessionCompactionHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const warnOnce = createWarnOnce()
  if (hooks["experimental.compaction.autocontinue"] !== undefined) {
    console.warn(
      "[v2-compaction-hook-bridge] experimental.compaction.autocontinue has no OpenCode V2 equivalent and is dropped",
    )
  }
  const handler = hooks["experimental.session.compacting"]
  if (!handler) return

  const invoke = createV1HookInvoker()
  collector.add(
    await ctx.session.hook("compaction", async (event) => {
      const context: string[] = []
      const output: { context: string[] } = { context }
      await invoke("experimental.session.compacting", handler, { sessionID: event.sessionID }, output)
      const prompt = (output as { prompt?: unknown }).prompt
      if (typeof prompt === "string" && prompt.length > 0) {
        warnOnce(
          "prompt-replacement",
          "experimental.session.compacting prompt replacement has no V2 equivalent; degraded",
          { sessionID: event.sessionID },
        )
      }
      appendContextToLastUserMessage(event, context, warnOnce)
    }),
  )
}

function createWarnOnce(): (
  key: string,
  message: string,
  context?: Record<string, unknown>,
) => void {
  const warned = new Set<string>()
  return (key, message, context) => {
    if (warned.has(key)) return
    warned.add(key)
    console.warn(`[v2-compaction-hook-bridge] ${message}`, context)
  }
}

/**
 * Appends each context string as a text part on the last `user`-role message
 * of the compaction request. The content array of a V2 Message instance is
 * readonly at the type level but mutable at runtime; the scoped assertion
 * keeps that controlled.
 */
function appendContextToLastUserMessage(
  event: { messages: ReadonlyArray<{ role: string; content: readonly unknown[] }> },
  context: readonly string[],
  warnOnce: (key: string, message: string, context?: Record<string, unknown>) => void,
): void {
  if (context.length === 0) return
  const target = findLastUserMessage(event.messages)
  if (target === undefined) {
    warnOnce(
      "no-user-message",
      "compaction context strings could not be appended (no user message in the V2 compaction request); degraded",
      { contextCount: context.length },
    )
    return
  }
  for (const text of context) {
    ;(target.content as unknown as unknown[]).push({ type: "text", text })
  }
}

function findLastUserMessage(
  messages: ReadonlyArray<{ role: string; content: readonly unknown[] }>,
): { content: readonly unknown[] } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message !== undefined && message.role === "user") return message
  }
  return undefined
}
