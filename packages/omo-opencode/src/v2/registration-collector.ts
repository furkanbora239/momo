import { log } from "../shared/logger"
import type { V2Registration } from "./types"

/**
 * Collects every `Registration` produced while wiring V1 momo hooks onto the
 * V2 domains, plus the shared safe-invoker / log-once primitives the family
 * bridges reuse. One broken V1 handler must never kill the V2 hook chain, and
 * degradations must warn once instead of per-message.
 */
export type V2RegistrationCollector = {
  add: (registration: V2Registration | undefined | null) => void
  snapshot: () => readonly V2Registration[]
  disposeAll: () => Promise<void>
}

export function createRegistrationCollector(): V2RegistrationCollector {
  const registrations: V2Registration[] = []
  return {
    add: (registration) => {
      if (registration) registrations.push(registration)
    },
    snapshot: () => [...registrations],
    disposeAll: async () => {
      for (const registration of registrations.splice(0)) {
        try {
          await registration.dispose()
        } catch (error) {
          log("[v2-hook-bridge] registration dispose failed", {
            error: error instanceof Error ? error : String(error),
          })
        }
      }
    },
  }
}

/** V1 hook handler shape: an `(input, output) => void` pair hook. */
export type V1PairHook<I, O> = (input: I, output: O) => Promise<void> | void

export type V1HookInvoker = <I, O>(
  hookName: string,
  handler: V1PairHook<I, O> | null | undefined,
  input: I,
  output: O,
) => Promise<void>

/**
 * Mirrors momo's own safe-hook discipline (see src/plugin/event-hook-dispatcher
 * `createEventHookRunner`): a throwing V1 handler is logged and skipped so the
 * remaining handlers and the V2 runtime keep running.
 */
export function createV1HookInvoker(): V1HookInvoker {
  return async (hookName, handler, input, output) => {
    if (!handler) return
    try {
      await Promise.resolve(handler(input, output))
    } catch (error) {
      log("[v2-hook-bridge] V1 hook invocation failed; continuing", {
        hook: hookName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export type V1HookInvokerSync = <I, O>(
  hookName: string,
  handler: V1PairHook<I, O> | null | undefined,
  input: I,
  output: O,
) => void

/**
 * Synchronous variant for the replayable `ctx.tool.transform` callback: the
 * handler's synchronous portion (the common case for momo's tool.definition
 * hooks) applies its mutations immediately; late async mutations degrade with
 * a log-once because transform callbacks must stay synchronous and cheap.
 */
export function createV1HookInvokerSync(logLateMutation: LogOnce): V1HookInvokerSync {
  return (hookName, handler, input, output) => {
    if (!handler) return
    try {
      const result = handler(input, output)
      void Promise.resolve(result).then(
        () => {},
        (error: unknown) => {
          logLateMutation(
            `late-async:${hookName}`,
            "late async V1 hook mutation degraded under the replayable V2 transform",
            { hook: hookName, error: error instanceof Error ? error : String(error) },
          )
        },
      )
    } catch (error) {
      log("[v2-hook-bridge] V1 hook invocation failed; continuing", {
        hook: hookName,
        error: error instanceof Error ? error : String(error),
      })
    }
  }
}

export type LogOnce = (key: string, message: string, context?: Record<string, unknown>) => void

/** Emits each degradation warning at most once per key. */
export function createLogOnce(scope: string): LogOnce {
  const seen = new Set<string>()
  return (key, message, context) => {
    if (seen.has(key)) return
    seen.add(key)
    log(`[${scope}] ${message}`, context)
  }
}

/**
 * Appends to a field whose declared element array is readonly at the type
 * level but mutable at runtime (V2 content arrays inside individual Message
 * instances). Scoped to the bridges so the controlled assertion stays local
 * and documented instead of spreading as casts.
 */
export function pushToReadonlyArray<T>(array: readonly T[], item: T): void {
  ;(array as unknown as T[]).push(item)
}

/** Joins the text of `type: "text"` parts, mirroring momo's extractPromptText. */
export function joinTextParts(parts: readonly { type: string; text?: string }[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
}
