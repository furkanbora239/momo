const store = new Map<string, Record<string, boolean>>();

export function setSessionTools(sessionID: string, tools: Record<string, boolean>): void {
  store.set(sessionID, { ...tools });
}

export function getSessionTools(sessionID: string): Record<string, boolean> | undefined {
  const tools = store.get(sessionID);
  return tools ? { ...tools } : undefined;
}

export function deleteSessionTools(sessionID: string): void {
  store.delete(sessionID);
}

export function clearSessionTools(): void {
  store.clear();
}

/**
 * V2 permission semantics: a tool mapped to `false` in the restriction record is
 * DENIED, which removes it from the agent's callable surface (it is not merely
 * hidden but still callable). Returns the names that should be removed.
 */
export function deriveRemovedToolNames(tools: Record<string, boolean>): string[] {
  return Object.keys(tools).filter((tool) => tools[tool] === false);
}

/**
 * Returns the tools the restriction record explicitly allows (`true`). Under V2
 * these are positively present on the worker surface even when a default would
 * otherwise omit them.
 */
export function deriveAllowedToolNames(tools: Record<string, boolean>): string[] {
  return Object.keys(tools).filter((tool) => tools[tool] === true);
}
