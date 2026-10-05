import { stripInvisibleAgentCharacters } from "./agent-display-names"

/**
 * OpenCode V2 renamed several built-in tools. momo's restriction tables were
 * authored against V1 tool names. Map them so denials still target a real tool
 * under V2: a denial on an unknown tool name is silently ignored by the server,
 * which would leave the tool callable on the child surface.
 */
export const V1_TO_V2_TOOL_NAME: Readonly<Record<string, string>> = {
  bash: "shell",
  task: "subagent",
  write: "edit",
  patch: "edit",
  apply_patch: "edit",
}

/** Map a V1 tool name to its V2 equivalent; pass through unknown names. */
export function normalizeToolName(tool: string): string {
  return V1_TO_V2_TOOL_NAME[tool] ?? tool
}

/** Normalize every key in a restriction record to its V2 tool name. */
export function normalizeToolRecord(record: Record<string, boolean>): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const [tool, value] of Object.entries(record)) {
    result[normalizeToolName(tool)] = value
  }
  return result
}

/**
 * Read-side tools a delegated execution worker must have on its surface.
 * Rationale + evidence: a delegated worker today has no skill tool and no
 * codegraph, and had to shell around them (momo_nots.md section 8.1). These are
 * folded into the execution-agent allow-set so the worker can read code
 * structure, load skills, and search the web without shelling around.
 */
export const WORKER_READ_SIDE_TOOLS: ReadonlyArray<string> = [
  "codegraph_status",
  "codegraph_explore",
  "codegraph_search",
  "codegraph_context",
  "codegraph_node",
  "codegraph_callers",
  "codegraph_callees",
  "codegraph_impact",
  "codegraph_files",
  "skill",
  "skill_mcp",
  "websearch",
  "webfetch",
]

/** Agents that perform direct execution and therefore need the worker baseline. */
const EXECUTION_AGENT_NAMES: ReadonlySet<string> = new Set([
  "sisyphus-junior",
  "worker",
  "executor",
])

/** Resolve the worker display/alias name to the canonical config key. */
function resolveAgentKey(agentName: string): string {
  const stripped = stripInvisibleAgentCharacters(agentName)
  if (stripped.toLowerCase() === "worker") return "sisyphus-junior"
  return stripped
}

const TEAM_TOOL_DENYLIST: Record<string, boolean> = {
  team_create: false,
  team_delete: false,
  team_shutdown_request: false,
  team_approve_shutdown: false,
  team_reject_shutdown: false,
  team_send_message: false,
  team_task_create: false,
  team_task_list: false,
  team_task_update: false,
  team_task_get: false,
  team_status: false,
  team_list: false,
}

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },

  metis: {
    write: false,
    edit: false,
  },

  momus: {
    write: false,
    edit: false,
  },

  planner: {
    write: false,
    edit: false,
  },

  executor: {
    write: false,
    edit: false,
    call_omo_agent: false,
  },

  reviewer: {
    write: false,
    edit: false,
  },

  research: EXPLORATION_AGENT_DENYLIST,

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },
}

type AgentToolRestrictionsOptions = {
  includeTeamToolDenylist?: boolean
}

export function getAgentToolRestrictions(agentName: string, options: AgentToolRestrictionsOptions = {}): Record<string, boolean> {
  const resolved = resolveAgentKey(agentName)
  const agentRestrictions = AGENT_RESTRICTIONS[resolved]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === resolved.toLowerCase())?.[1]
    ?? {}

  const base: Record<string, boolean> = {
    ...(options.includeTeamToolDenylist === false ? {} : TEAM_TOOL_DENYLIST),
    ...agentRestrictions,
  }

  const result = normalizeToolRecord(base)

  if (EXECUTION_AGENT_NAMES.has(resolved)) {
    for (const tool of WORKER_READ_SIDE_TOOLS) {
      if (result[tool] === undefined) {
        result[tool] = true
      }
    }
  }

  return result
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = getAgentToolRestrictions(agentName)
  return Object.keys(restrictions).length > 0
}
