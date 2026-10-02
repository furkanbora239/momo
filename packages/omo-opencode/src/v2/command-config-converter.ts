// command-config-converter.ts — pure converter from momo's V1 command entries
// (prompt templates produced by command-config-handler.ts) to V2
// `CommandDefinition`s for the command domain transform.
//
// V2 ground truth: `CommandDefinition` / `CommandInvocation` from
// @opencode/plugin/promise/command — a command carries {name, description?,
// execute}; execution receives {sessionID, prompt, delivery} and must deliver
// the prompt to the session itself. The V2 client prompt input flattens prompt
// parts into {sessionID, text, files?, agents?, skills?} (grounded from the
// generated client types), so attachments ride along with the template text.

import type { CommandDefinition } from "@opencode/plugin/promise/command"
import type { V2PluginContext } from "./types"

export type V1CommandEntry = {
  readonly template?: string
  readonly description?: string
  readonly agent?: string
  readonly model?: string
  readonly subtask?: boolean
}

/** Exact input shape the V2 session prompt accepts (from the plugin context). */
export type V2CommandPromptInput = Parameters<V2PluginContext["session"]["prompt"]>[0]

export type V2PromptSender = (input: V2CommandPromptInput) => Promise<unknown>

/**
 * Convert one V1 command entry into a V2 CommandDefinition whose execute
 * re-delivers the invocation prompt through the provided sender. Pure and
 * synchronous; only `execute` awaits (at invocation time, not transform time).
 */
export function convertV1CommandDefinition(
  name: string,
  entry: V1CommandEntry,
  prompt: V2PromptSender,
): CommandDefinition {
  return {
    name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    execute: async (invocation) => {
      const part = invocation.prompt
      await prompt({
        sessionID: invocation.sessionID,
        text: part.text,
        ...(part.files !== undefined && part.files.length > 0 ? { files: part.files } : {}),
        ...(part.agents !== undefined && part.agents.length > 0 ? { agents: part.agents } : {}),
        ...(part.skills !== undefined && part.skills.length > 0 ? { skills: part.skills } : {}),
      })
    },
  }
}
