import { isNativePrivacyPolicyRejection, type NativeModelPolicyHealth } from "../native-catalog/model-policy-health"
import type { NativeTask, NativeTaskRuntime } from "../native-task/types"

/** Inspection binds a failure to native message identity and model, never task prose. */
export function createNativeModelPolicyObserver(runtime: Pick<NativeTaskRuntime, "inspect">, health: NativeModelPolicyHealth) {
  return async (task: NativeTask, error: string): Promise<void> => {
    if (!isNativePrivacyPolicyRejection(error)) return
    if (!task.model || !task.sessionID) return
    const observed = await runtime.inspect(task.sessionID)
    if (observed.failureModel && (observed.failureModel.providerID !== task.model.providerID || observed.failureModel.id !== task.model.id)) return
    if (observed.state !== "failed" || !observed.error || !observed.failureID || !observed.failureModel) {
      throw new Error("Native privacy failure evidence is not yet available")
    }
    const failureID = observed.failureID
    await health.observe(task.model, { message: observed.error, taskID: task.id, sessionID: task.sessionID, failureID, occurredAt: observed.failureAt })
  }
}
