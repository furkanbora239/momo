import type { PluginContext } from "../plugin/types"
import { log } from "../shared/logger"
import { createAppClientBridge } from "./app-client-bridge"
import { createUnmappedNoOpMethod } from "./client-bridge-result"
import { createModelClientBridge } from "./model-client-bridge"
import { createProviderClientBridge } from "./provider-client-bridge"
import { createSessionClientBridge } from "./session-client-bridge"
import type { V2PluginContext } from "./types"

type V1Client = PluginContext["client"]

export function createV2PluginInput(ctx: V2PluginContext): PluginContext {
  const directory = ctx.location.directory
  return {
    project: {
      id: ctx.location.project.id,
      worktree: directory,
      time: { created: Date.now() },
    },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: undefined,
    $: createStubBunShell(),
    client: createV1ClientFacade(ctx),
  }
}

function createStubBunShell(): PluginContext["$"] {
  const shell = Object.assign(
    () => {
      throw new Error("Bun shell is not available under the OpenCode V2 runtime")
    },
    {
      braces: (): string[] => [],
      escape: (input: string): string => input,
      env() {
        return shell
      },
      cwd() {
        return shell
      },
      nothrow() {
        return shell
      },
      throws() {
        return shell
      },
    },
  )
  return shell
}

/**
 * V1 client APIs momo calls that have no faithful V2 ctx equivalent. Each
 * degrades to a logged no-op resolving undefined (never fabricated data).
 * Explicit gap registry: greppable, and asserted in client-bridge.test.ts.
 */
export const UNMAPPED_V1_CLIENT_APIS = [
  { api: "tui.showToast", reason: "the V2 TUI lives in the separate @opencode/plugin/tui entry" },
  { api: "session.todo", reason: "the V2 client has no todo API" },
  { api: "session.status", reason: "the V2 plugin ctx exposes no session status API" },
  { api: "session.list", reason: "the V2 plugin ctx exposes no session list API" },
  { api: "session.children", reason: "the V2 plugin ctx exposes no session children API" },
  { api: "session.message", reason: "the V2 plugin ctx exposes no single-message API" },
  { api: "event.subscribe", reason: "V2 events use the V2Event shape; no facade consumer today" },
] as const

/**
 * Builds the V1 client facade over the V2 ctx: an explicit typed core of the
 * mapped domains (session, provider, model, app, tui), a method-level
 * fallback per mapped domain, and a top-level Proxy fallback for every
 * unmapped domain. Unmapped access degrades to a logged no-op resolving
 * undefined instead of a TypeError.
 */
export function createV1ClientFacade(
  ctx: V2PluginContext,
  logFn: (message: string, data?: unknown) => void = log,
): V1Client {
  const unmapped = new Set<string>()
  const core = {
    session: withUnmappedMethodFallback("session", createSessionClientBridge(ctx), unmapped, logFn),
    provider: withUnmappedMethodFallback("provider", createProviderClientBridge(ctx), unmapped, logFn),
    model: withUnmappedMethodFallback("model", createModelClientBridge(ctx), unmapped, logFn),
    app: withUnmappedMethodFallback("app", createAppClientBridge(ctx), unmapped, logFn),
    tui: withUnmappedMethodFallback("tui", createTuiClientBridge(logFn), unmapped, logFn),
  }
  return new Proxy(core, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver)
      return createUnmappedNoOp(prop, unmapped, logFn)
    },
  }) as unknown as V1Client
}

function createTuiClientBridge(logFn: (message: string, data?: unknown) => void = log) {
  return {
    showToast: createUnmappedNoOpMethod(
      "tui.showToast",
      "the V2 TUI lives in the separate @opencode/plugin/tui entry",
      logFn,
    ),
  }
}

/** Wraps a mapped domain so unknown methods degrade to logged no-ops. */
function withUnmappedMethodFallback<TDomain extends object>(
  domain: string,
  methods: TDomain,
  unmapped: Set<string>,
  logFn: (message: string, data?: unknown) => void = log,
): TDomain {
  return new Proxy(methods, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver)
      return createUnmappedNoOp(`${domain}.${prop}`, unmapped, logFn)
    },
  })
}

const NON_METHOD_PROPS = new Set([
  "then",
  "catch",
  "finally",
  "name",
  "length",
  "caller",
  "arguments",
  "constructor",
  "prototype",
  "toJSON",
])

/**
 * Callable logged no-op that also yields no-op methods for domain-style
 * access (`client.event.subscribe(...)`), so any unmapped V1 call shape
 * degrades to undefined instead of a TypeError. Logs once per api path.
 */
function createUnmappedNoOp(
  api: string,
  unmapped: Set<string>,
  logFn: (message: string, data?: unknown) => void = log,
): () => Promise<undefined> {
  const noOp = async (): Promise<undefined> => {
    if (!unmapped.has(api)) {
      unmapped.add(api)
      logFn("[v2-client-bridge] unmapped V1 client API degraded to no-op", { api })
    }
    return undefined
  }
  return new Proxy(noOp, {
    get(target, prop) {
      if (typeof prop !== "string" || NON_METHOD_PROPS.has(prop)) return Reflect.get(target, prop)
      return createUnmappedNoOp(`${api}.${prop}`, unmapped, logFn)
    },
  })
}
