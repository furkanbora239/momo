export function createNativeTaskID(): string {
  return `ntask_${globalThis.crypto.randomUUID()}`
}
