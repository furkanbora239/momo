import { isNativePrivacyPolicyRejection } from "../native-catalog/model-policy-health"
import { errorText } from "./lifecycle"
import type { NativeTask, NativeTaskEngineOptions } from "./types"

export function markNativeExecutionFailurePending(task: NativeTask, error: string): void {
  if (isNativePrivacyPolicyRejection(error)) task.failureObservationError ??= "Native privacy failure observation is pending"
}

/** Persist unresolved policy observation before another selected model can dispatch. */
export async function observeNativeExecutionFailure(task: NativeTask, error: string, deps: {
  onExecutionFailure?: NativeTaskEngineOptions["onExecutionFailure"]
  save: (task: NativeTask) => Promise<NativeTask>
}): Promise<void> {
  if (!deps.onExecutionFailure) return
  let failureObservationError: string | undefined
  try { await deps.onExecutionFailure(task, error) }
  catch (failure) { failureObservationError = errorText(failure) }
  if (task.failureObservationError === failureObservationError) return
  task.failureObservationError = failureObservationError
  await deps.save(task)
}
