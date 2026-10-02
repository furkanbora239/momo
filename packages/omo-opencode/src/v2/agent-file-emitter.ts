// agent-file-emitter.ts — register NEW agents (present in the V1 config diff,
// absent from ctx.agent.list()) as file-based agent definitions.
//
// The V2 AgentEditor (promise/agent.d.ts) exposes only list/get/default/
// update/remove — it cannot add. OpenCode V2 supports file-based agents at
// `~/.config/opencode/agents/<name>.md` (project fallback:
// `<directory>/.opencode/agents/<name>.md`): YAML frontmatter carries the same
// fields as an `agents` configuration entry (description, mode, model,
// permissions, steps, hidden, color, disabled, request.body) and the Markdown
// body becomes the agent's system prompt. Grounded from the V2 agents docs
// (opencode.ai/v2/docs/agents) and the @opencode/schema config agent entry —
// which has no `name` and no `tools` field, so the kebab-case file stem is the
// agent id and V1 `tools` maps have no V2 frontmatter home.
//
// Idempotence: one file per agent, never overwrite an existing file.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../shared/logger"
import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import { convertV1PermissionToRules, type V1AgentEntry } from "./agent-config-converter"

export interface NewAgentEntry {
  readonly id: string
  readonly entry: V1AgentEntry
}

export interface AgentEmissionOptions {
  /** Explicit target directory (tests and callers that already know where). */
  readonly preferredDirectory?: string
  /** Project root for the fallback `.opencode/agents` directory. */
  readonly fallbackRoot: string
}

export interface AgentEmissionResult {
  readonly directory: string
  readonly emitted: readonly string[]
  readonly skipped: readonly string[]
}

/** JSON-quoted strings are valid YAML double-quoted scalars. */
function quoteYamlScalar(value: string): string {
  return JSON.stringify(value)
}

function frontmatterField(entry: V1AgentEntry, rules: ReturnType<typeof convertV1PermissionToRules>): string[] {
  const lines: string[] = []
  if (typeof entry.description === "string") {
    lines.push(`description: ${quoteYamlScalar(entry.description)}`)
  }
  if (entry.mode !== undefined) {
    lines.push(`mode: ${entry.mode}`)
  }
  if (typeof entry.model === "string") {
    lines.push(`model: ${quoteYamlScalar(entry.model)}`)
  }
  if (rules.length > 0) {
    lines.push("permissions:")
    for (const rule of rules) {
      lines.push(`  - action: ${rule.action}`)
      lines.push(`    resource: ${quoteYamlScalar(rule.resource)}`)
      lines.push(`    effect: ${rule.effect}`)
    }
  }
  if (typeof entry.maxSteps === "number") {
    lines.push(`steps: ${entry.maxSteps}`)
  }
  if (typeof entry.color === "string") {
    lines.push(`color: ${quoteYamlScalar(entry.color)}`)
  }
  if (entry.disable !== undefined) {
    lines.push(`disabled: ${entry.disable}`)
  }
  if (typeof entry.temperature === "number" || typeof entry.top_p === "number") {
    lines.push("request:", "  body:")
    if (typeof entry.temperature === "number") lines.push(`    temperature: ${entry.temperature}`)
    if (typeof entry.top_p === "number") lines.push(`    top_p: ${entry.top_p}`)
  }
  return lines
}

/** V1 agent entry -> `<agent-id>.md` content (frontmatter + system prompt body). */
export function buildAgentMarkdown(agentId: string, entry: V1AgentEntry): string {
  const rules = entry.permission !== undefined ? convertV1PermissionToRules(entry.permission) : []
  const body = typeof entry.prompt === "string" ? entry.prompt : ""
  return ["---", ...frontmatterField(entry, rules), "---", "", body, ""].join("\n")
}

/** kebab-case file stem for an agent id (the stem becomes the V2 agent id). */
export function toKebabFileStem(agentId: string): string {
  const kebab = agentId
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
  return kebab.length > 0 ? kebab : "agent"
}

/**
 * User-level agents directory via momo's opencode config-dir helper
 * (`~/.config/opencode/agents`, honoring OPENCODE_CONFIG_DIR); degrades to the
 * project `.opencode/agents` directory when the user-level path is unusable.
 */
export function resolveAgentEmissionDirectory(options: AgentEmissionOptions): string {
  if (options.preferredDirectory !== undefined) return options.preferredDirectory
  try {
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    if (configDir.length > 0) return join(configDir, "agents")
  } catch (error) {
    log("[v2-agent-file-emitter] user config dir unavailable; using project agents dir", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return join(options.fallbackRoot, ".opencode", "agents")
}

function ensureWritableDirectory(directory: string, fallbackRoot: string): string {
  try {
    mkdirSync(directory, { recursive: true })
    return directory
  } catch (error) {
    log("[v2-agent-file-emitter] agents directory not writable; falling back to project dir", {
      directory,
      error: error instanceof Error ? error.message : String(error),
    })
    const projectDirectory = join(fallbackRoot, ".opencode", "agents")
    mkdirSync(projectDirectory, { recursive: true })
    return projectDirectory
  }
}

/**
 * Emit one `<agent-id>.md` file per new agent. Existing files are never
 * overwritten (skipped and counted). Pure aside from the fs writes.
 */
export async function emitNewAgentFiles(
  agents: readonly NewAgentEntry[],
  options: AgentEmissionOptions,
): Promise<AgentEmissionResult> {
  const resolved = resolveAgentEmissionDirectory(options)
  if (agents.length === 0) {
    return { directory: resolved, emitted: [], skipped: [] }
  }
  const directory = ensureWritableDirectory(resolved, options.fallbackRoot)
  const emitted: string[] = []
  const skipped: string[] = []
  for (const agent of agents) {
    const filePath = join(directory, `${toKebabFileStem(agent.id)}.md`)
    if (existsSync(filePath)) {
      log("[v2-agent-file-emitter] agent file exists; not overwritten", { agentId: agent.id, filePath })
      skipped.push(agent.id)
      continue
    }
    writeFileSync(filePath, buildAgentMarkdown(agent.id, agent.entry), "utf-8")
    emitted.push(agent.id)
  }
  return { directory, emitted, skipped }
}
