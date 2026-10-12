import type { NativeRole, NativeRouteInput } from "./types"

const ROOT_ROLES: readonly NativeRole[] = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"]
const DEPARTMENT_CHILD_ROLES: readonly NativeRole[] = ["worker", "explore", "librarian", "research", "catalog-researcher"]
const WORKER_ROLES = new Set<NativeRole>(["worker", "explore", "librarian", "research", "catalog-researcher"])

export function allowedRoles(input: NativeRouteInput): readonly NativeRole[] {
  const roles = input.kind === "consultation"
    ? ["advisor"] as const
    : input.parentRole === "orchestrator"
      ? ROOT_ROLES
      : input.parentRole === "planner" || input.parentRole === "executor" || input.parentRole === "reviewer"
        ? DEPARTMENT_CHILD_ROLES
        : []
  return input.requiredRole === undefined ? roles : roles.filter((role) => role === input.requiredRole)
}

export function isRole(value: string): value is NativeRole {
  return value === "orchestrator" || value === "planner" || value === "executor" || value === "reviewer" ||
    value === "worker" || value === "explore" || value === "librarian" || value === "research" ||
    value === "catalog-researcher" || value === "advisor"
}

export function validateInput(input: NativeRouteInput): string | undefined {
  if (!input.prompt.trim()) return "task prompt is required"
  if (!input.rootSessionID || !input.parentSessionID) return "root and parent session IDs are required"
  if (!isRole(input.parentRole)) return `unknown parent role: ${input.parentRole}`
  if (input.kind !== "task" && input.kind !== "consultation") return "unknown routing kind"
  if (input.kind === "consultation" && input.parentRole === "advisor") return "advisor cannot start a consultation"
  if (input.requiredRole !== undefined && (input.requiredRole !== "catalog-researcher" || input.kind !== "task" || input.parentRole !== "orchestrator")) {
    return "required role is reserved for root-orchestrator catalog research"
  }
  if (input.kind === "task" && (WORKER_ROLES.has(input.parentRole) || input.parentRole === "advisor")) {
    return `${input.parentRole} cannot delegate tasks`
  }
  return undefined
}
