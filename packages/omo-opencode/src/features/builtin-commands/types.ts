import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName =
  | "goal"
  | "stop-continuation"
  | "handoff"
  | "advisor"
  | "momo"
  | "caveman"
  | "cavemen"
  | "c"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
