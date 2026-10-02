import type { Part as V1SdkPart } from "@opencode-ai/sdk"
import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import { log } from "../shared/logger"
import type { V2PluginContext } from "./types"
import {
  createLogOnce,
  createV1HookInvoker,
  joinTextParts,
  type V2RegistrationCollector,
} from "./registration-collector"

/**
 * Decision record (task item 10): the momo `command.execute.before` handler
 * (src/plugin/command-execute-before.ts) mutates `output.parts` to reshape the
 * outgoing prompt (auto-slash-command expansion, the native goal marker, the
 * start-work injection), which is prompt-modification intent. Under V2 it is
 * therefore mapped onto a SECOND `session.hook("prompt", ...)` registration
 * that runs before the `chat.message` bridge; pure command interception
 * (config-owned registration) is not in scope for this bridge. The V2 prompt
 * hook only sees slash-shaped text when the raw command reaches it, so the
 * adapter parses `/<command> <arguments>` from `prompt.text` and degrades
 * silently otherwise.
 */
export async function registerSessionPromptHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const logOnce = createLogOnce("v2-prompt-hook-bridge")
  const invoke = createV1HookInvoker()

  collector.add(
    await ctx.session.hook("prompt", async (event) => {
      const parsed = parseCommandPrompt(event.prompt.text)
      if (parsed === undefined) return
      const parts: V1SdkPart[] = [
        {
          id: `${event.messageID}_command_text`,
          sessionID: event.sessionID,
          messageID: event.messageID,
          type: "text",
          text: event.prompt.text,
        },
      ]
      const before = JSON.stringify(parts)
      await invoke(
        "command.execute.before",
        hooks["command.execute.before"],
        { command: parsed.command, sessionID: event.sessionID, arguments: parsed.arguments },
        { parts },
      )
      if (JSON.stringify(parts) !== before) {
        applyPartsToPrompt(event, parts, logOnce, "command.execute.before")
      }
    }),
  )

  collector.add(
    await ctx.session.hook("prompt", async (event) => {
      const hydrated = await hydrateSessionRef(ctx, event.sessionID, logOnce)
      const message = buildUserMessageView(event, hydrated)
      const parts = buildPromptPartsView(event)
      const partsBefore = JSON.stringify(parts)
      const messageBefore = JSON.stringify(message)
      await invoke("chat.message", hooks["chat.message"], { ...inputView(event), ...hydrated }, { message, parts })
      if (JSON.stringify(message) !== messageBefore) {
        logOnce(
          "message-level-mutation",
          "chat.message mutations on output.message (model/variant/agent) have no V2 prompt equivalent; degraded",
          { sessionID: event.sessionID, messageID: event.messageID },
        )
      }
      if (JSON.stringify(parts) !== partsBefore) {
        applyPartsToPrompt(event, parts, logOnce, "chat.message")
      }
    }),
  )
}

type PromptEventView = {
  readonly sessionID: string
  readonly messageID: string
  prompt: { text: string; files?: ReadonlyArray<{ readonly uri: string }> }
}

type HydratedSessionRef = {
  agent?: string
  model?: { providerID: string; modelID: string }
}

async function hydrateSessionRef(
  ctx: V2PluginContext,
  sessionID: string,
  logOnce: ReturnType<typeof createLogOnce>,
): Promise<HydratedSessionRef> {
  try {
    const info = await ctx.session.get({ sessionID })
    return {
      ...(info.agent !== undefined ? { agent: info.agent } : {}),
      ...(info.model !== undefined
        ? { model: { providerID: info.model.providerID, modelID: info.model.id } }
        : {}),
    }
  } catch (error) {
    logOnce("session-hydrate", "session.get hydration failed; chat.message view degrades", {
      sessionID,
      error: error instanceof Error ? error : String(error),
    })
    return {}
  }
}

/**
 * Builds the V1 `UserMessage` view over the V2 prompt. Fields V2 does not
 * surface degrade: agent/model hydrate from the session record when possible
 * and otherwise fall back to neutral placeholders so momo's no-model guard
 * never spuriously fires on the adapted view; `time.created` is view-only and
 * never persisted.
 */
function buildUserMessageView(
  event: PromptEventView,
  hydrated: HydratedSessionRef,
): { id: string; sessionID: string; role: "user"; time: { created: number }; agent: string; model: { providerID: string; modelID: string } } {
  return {
    id: event.messageID,
    sessionID: event.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: hydrated.agent ?? "default",
    model: hydrated.model ?? { providerID: "unknown", modelID: "unknown" },
  }
}

function buildPromptPartsView(event: PromptEventView): V1SdkPart[] {
  return [
    {
      id: `${event.messageID}_text`,
      sessionID: event.sessionID,
      messageID: event.messageID,
      type: "text",
      text: event.prompt.text,
    },
  ]
}

function inputView(event: PromptEventView): {
  sessionID: string
  messageID: string
} {
  return { sessionID: event.sessionID, messageID: event.messageID }
}

/**
 * Write-back: V1 handlers mutate the flat `parts` array; the V2 prompt carries
 * a single `text` string, so the joined text view flows back (mirroring momo's
 * own `extractPromptText` join). Added non-text parts (attachments) have no V2
 * prompt equivalent and degrade with a log-once.
 */
function applyPartsToPrompt(
  event: PromptEventView,
  parts: readonly { type: string; text?: string }[],
  logOnce: ReturnType<typeof createLogOnce>,
  source: string,
): void {
  log(`[v2-prompt-hook-bridge] ${source} mutated the prompt parts; flowing text back into the V2 prompt`, {
    sessionID: event.sessionID,
    messageID: event.messageID,
  })
  event.prompt.text = joinTextParts(parts)
  if (parts.some((part) => part.type !== "text")) {
    logOnce(
      `${source}:non-text-parts`,
      "non-text parts added by a V1 handler cannot flow back into the V2 prompt; degraded",
      { sessionID: event.sessionID, messageID: event.messageID },
    )
  }
}

export function parseCommandPrompt(text: string): { command: string; arguments: string } | undefined {
  if (!text.startsWith("/")) return undefined
  const body = text.slice(1)
  if (body.length === 0) return undefined
  const separator = body.search(/\s/)
  if (separator === -1) return { command: body, arguments: "" }
  return { command: body.slice(0, separator), arguments: body.slice(separator + 1) }
}
