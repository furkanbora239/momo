import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import orchestrator from "../../../assets/native-agents/momo-orchestrator.md" with { type: "text" }
import planner from "../../../assets/native-agents/momo-planner.md" with { type: "text" }
import executor from "../../../assets/native-agents/momo-executor.md" with { type: "text" }
import reviewer from "../../../assets/native-agents/momo-reviewer.md" with { type: "text" }
import worker from "../../../assets/native-agents/momo-worker.md" with { type: "text" }
import explore from "../../../assets/native-agents/momo-explore.md" with { type: "text" }
import librarian from "../../../assets/native-agents/momo-librarian.md" with { type: "text" }
import research from "../../../assets/native-agents/momo-research.md" with { type: "text" }
import catalogResearcher from "../../../assets/native-agents/momo-catalog-researcher.md" with { type: "text" }
import advisor from "../../../assets/native-agents/momo-advisor.md" with { type: "text" }

const marker = "<!-- momo-native-agent-owned:v1 -->"
const definitions = new Map([
  ["momo-orchestrator", orchestrator], ["momo-planner", planner], ["momo-executor", executor],
  ["momo-reviewer", reviewer], ["momo-worker", worker], ["momo-explore", explore],
  ["momo-librarian", librarian], ["momo-research", research],
  ["momo-catalog-researcher", catalogResearcher], ["momo-advisor", advisor],
])

export type OwnedAgentInstall = { directory: string; installed: string[]; updated: string[]; conflicts: string[]; owned: string[] }

function agentDirectory(): string {
  try {
    return join(getOpenCodeConfigDir({ binary: "opencode" }), "agents")
  } catch {
    const testHome = process.env.OPENCODE_TEST_HOME
    return join(testHome ?? homedir(), ".config", "opencode", "agents")
  }
}

export function installOwnedAgents(directory = agentDirectory()): OwnedAgentInstall {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const result: OwnedAgentInstall = { directory, installed: [], updated: [], conflicts: [], owned: [] }
  for (const [id, content] of definitions) {
    const filePath = join(directory, `${id}.md`)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 })
      result.installed.push(id)
      result.owned.push(id)
      continue
    }
    const existing = readFileSync(filePath, "utf8")
    if (!existing.includes(marker)) {
      result.conflicts.push(id)
      continue
    }
    result.owned.push(id)
    if (existing !== content) {
      writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 })
      result.updated.push(id)
    }
  }
  return result
}

export function ownedAgentIds(): string[] {
  return [...definitions.keys()]
}

export function agentRoleFromId(id: string): string | undefined {
  if (!id.startsWith("momo-")) return undefined
  return id.slice("momo-".length)
}
