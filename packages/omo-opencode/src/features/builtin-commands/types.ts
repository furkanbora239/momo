import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName = "goal" | "stop-continuation" | "handoff" | "advisor" | "help"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
