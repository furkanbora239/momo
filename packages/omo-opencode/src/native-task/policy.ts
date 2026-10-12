import type { NativeTaskRole } from "./types"

const DEPARTMENT_ROLES = new Set<NativeTaskRole>(["planner", "executor", "reviewer"])
const SINGLE_AGENT_ROLES = new Set<NativeTaskRole>([
  "worker",
  "explore",
  "librarian",
  "research",
  "catalog-researcher",
])

export function mayCreateTask(parentRole: NativeTaskRole): boolean {
  return parentRole === "orchestrator" || DEPARTMENT_ROLES.has(parentRole)
}

export function mayCreateChildRole(parentRole: NativeTaskRole, childRole: NativeTaskRole): boolean {
  if (parentRole === "orchestrator") {
    return DEPARTMENT_ROLES.has(childRole) || SINGLE_AGENT_ROLES.has(childRole)
  }
  return DEPARTMENT_ROLES.has(parentRole) && SINGLE_AGENT_ROLES.has(childRole)
}

export function isValidRoutedRole(kind: "task" | "consultation", role: NativeTaskRole): boolean {
  return kind === "consultation" ? role === "advisor" : role !== "advisor" && role !== "orchestrator"
}
