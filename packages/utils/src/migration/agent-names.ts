export const AGENT_NAME_MAP: Record<string, string> = {
  // Sisyphus / Orchestrator variants → "sisyphus"
  omo: "sisyphus",
  OmO: "sisyphus",
  Sisyphus: "sisyphus",
  "Sisyphus (Ultraworker)": "sisyphus",
  "Sisyphus - ultraworker": "sisyphus",
  "sisyphus - ultraworker": "sisyphus",
  sisyphus: "sisyphus",
  orchestrator: "sisyphus",
  Orchestrator: "sisyphus",

  // Hephaestus / Coder variants → "hephaestus"
  "Hephaestus (Deep Agent)": "hephaestus",
  "Hephaestus - Deep Agent": "hephaestus",
  "hephaestus - deep agent": "hephaestus",
  hephaestus: "hephaestus",
  coder: "hephaestus",
  Coder: "hephaestus",

  // Prometheus / Planner variants → "prometheus"
  "OmO-Plan": "prometheus",
  "omo-plan": "prometheus",
  "Planner-Sisyphus": "prometheus",
  "planner-sisyphus": "prometheus",
  "Prometheus - Plan Builder": "prometheus",
  "Prometheus (Plan Builder)": "prometheus",
  "prometheus - plan builder": "prometheus",
  prometheus: "prometheus",
  planner: "prometheus",
  Planner: "prometheus",

  // Atlas / Coordinator variants → "atlas"
  "orchestrator-sisyphus": "atlas",
  Atlas: "atlas",
  "Atlas (Plan Executor)": "atlas",
  "Atlas - Plan Executor": "atlas",
  "atlas - plan executor": "atlas",
  atlas: "atlas",
  coordinator: "atlas",
  Coordinator: "atlas",

  // Metis / Analyst variants → "metis"
  "plan-consultant": "metis",
  "Metis - Plan Consultant": "metis",
  "Metis (Plan Consultant)": "metis",
  "metis - plan consultant": "metis",
  metis: "metis",
  analyst: "metis",
  Analyst: "metis",

  // Momus / Critic variants → "momus"
  "Momus - Plan Critic": "momus",
  "Momus (Plan Critic)": "momus",
  "momus - plan critic": "momus",
  momus: "momus",
  critic: "momus",
  Critic: "momus",

  // Sisyphus-Junior / Worker → "sisyphus-junior"
  "Sisyphus-Junior": "sisyphus-junior",
  "sisyphus-junior": "sisyphus-junior",
  worker: "sisyphus-junior",
  Worker: "sisyphus-junior",

  // Oracle / Architect variants → "oracle"
  oracle: "oracle",
  Oracle: "oracle",
  architect: "oracle",
  Architect: "oracle",

  // Explore / Explorer variants → "explore"
  explore: "explore",
  Explore: "explore",
  explorer: "explore",
  Explorer: "explore",

  // Multimodal-looker / Vision variants → "multimodal-looker"
  "multimodal-looker": "multimodal-looker",
  vision: "multimodal-looker",
  Vision: "multimodal-looker",

  // Athena / Council
  athena: "athena",
  council: "athena",
  Council: "athena",
  "athena-junior": "athena-junior",
  "council-worker": "athena-junior",

  // Passthroughs
  build: "build",
  librarian: "librarian",
}

export const BUILTIN_AGENT_NAMES = new Set([
  "sisyphus",
  "orchestrator",
  "oracle",
  "architect",
  "librarian",
  "explore",
  "explorer",
  "multimodal-looker",
  "vision",
  "metis",
  "analyst",
  "momus",
  "critic",
  "prometheus",
  "planner",
  "atlas",
  "coordinator",
  "hephaestus",
  "coder",
  "sisyphus-junior",
  "worker",
  "build",
])

export function migrateAgentNames(
  agents: Record<string, unknown>
): { migrated: Record<string, unknown>; changed: boolean } {
  const migrated: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(agents)) {
    const newKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key
    if (newKey !== key) {
      changed = true
    }
    migrated[newKey] = value
  }

  return { migrated, changed }
}
