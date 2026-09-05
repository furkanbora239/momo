import type { CommandDefinition } from "../claude-code-command-loader"
import type { BuiltinCommandName, BuiltinCommands } from "./types"
import { GOAL_TEMPLATE } from "./templates/goal"
import { STOP_CONTINUATION_TEMPLATE } from "./templates/stop-continuation"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import { HELP_TEMPLATE } from "./templates/help"

interface LoadBuiltinCommandsOptions {
  useRegisteredAgents?: boolean
  teamModeEnabled?: boolean
}

function createBuiltinCommandDefinitions(
  _options?: LoadBuiltinCommandsOptions,
): Record<BuiltinCommandName, Omit<CommandDefinition, "name">> {
  return {
    goal: {
      description: "(builtin) Set, show, pause, resume, or clear the active thread goal",
      template: `<command-instruction>
${GOAL_TEMPLATE}
</command-instruction>

<user-task>
$ARGUMENTS
</user-task>`,
      argumentHint: "<objective> | pause | resume | clear",
    },
    "stop-continuation": {
      description: "(builtin) Stop all continuation mechanisms (ralph loop, todo continuation, boulder) for this session",
      template: `<command-instruction>
${STOP_CONTINUATION_TEMPLATE}
</command-instruction>`,
    },
    handoff: {
      description: "(builtin) Create a detailed context summary for continuing work in a new session",
      template: `<command-instruction>
${HANDOFF_TEMPLATE}
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[goal]",
    },
    advisor: {
      description: "(builtin) Bind a model to the advisor agent for this session, or report/unbind it (momo)",
      template: `<command-instruction>
# /advisor — bind the advisor agent

The advisor is a bound-on-demand senior model. By default it is UNBOUND (zero
surprise cost): delegation to it is rejected until a model is bound. Use this
command to bind a model for the current session only (session-scoped; nothing
is written to disk).

## Behavior

Parse $ARGUMENTS and act via the \`advisor\` tool:

- No arguments → call \`advisor\` with action="report" and relay the result.
- \`off\` / \`unbind\` / \`disable\` → call \`advisor\` with action="off".
- A model id (e.g. \`neuralwatt/kimi-k3\`) → first call the \`catalog_list\` MCP
tool to show the user the connected, catalogued models; if the requested
model is not in the catalog, say so and suggest closest matches. Then call
\`advisor\` with action="bind" and model="<model-id>" and relay the result.

Do NOT claim a binding changed without a successful \`advisor\` tool result.

## After binding

When the advisor is needed, delegate to it with subagent_type="advisor" via the
normal task/delegate path. The session-scoped binding overrides the registered
model for that delegation. The orchestrator must never self-implement; the
advisor returns only short directives.

## Persistent alternative

To keep a binding across sessions, set \`agents.advisor.model\` in
\`~/.omo/omo.jsonc\` instead. A session binding (this command) takes precedence
over that config.
</command-instruction>

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "<model-id> | off | (no args to report)",
    },
    help: {
      description: "(builtin) Display comprehensive help, command reference, agent roles, and usage guide for momo",
      template: `<command-instruction>
${HELP_TEMPLATE}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`,
      argumentHint: "[command | topic | agents | config]",
    },
  }
}

export function loadBuiltinCommands(
  disabledCommands?: readonly string[] | (BuiltinCommandName | string)[],
  options?: LoadBuiltinCommandsOptions,
): BuiltinCommands {
  const builtinCommandDefinitions = createBuiltinCommandDefinitions(options)
  const disabled = new Set(disabledCommands ?? [])
  const commands: BuiltinCommands = {}

  for (const [name, definition] of Object.entries(builtinCommandDefinitions)) {
    if (!disabled.has(name as BuiltinCommandName)) {
      const { argumentHint: _argumentHint, ...openCodeCompatible } = definition
      commands[name] = { ...openCodeCompatible, name } as CommandDefinition
    }
  }

  return commands
}
