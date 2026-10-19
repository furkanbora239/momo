// MODIFIED: task class selection uses cached catalog profiles and the shared audited transport.
import { NativeJevAdmissionError } from "@oh-my-opencode/decision-core"
import { executeAuditedNativeJev, nativeJevFailureAdmission, type NativeJevBackendDeps } from "./jev-adapter"
import { JobClassSelectionError, selectJobClassModel, type JobClassSelectionOptions } from "./job-class-selection"
import type { NativeJev } from "./types"

export function createJobClassJevBackend(deps: NativeJevBackendDeps, options: JobClassSelectionOptions & {
  readonly prepare: () => Promise<unknown>
}): NativeJev {
  return {
    // The router calls this before acquiring the paid-call queue: classification
    // itself uses that queue, so preparing inside choose would deadlock.
    prepare: () => options.prepare().then(() => undefined),
    async choose(request, audit) {
      const models = [...new Map(request.candidates.map(candidate => [JSON.stringify(candidate.model), candidate.model])).values()]
      const membershipState = () => JSON.stringify(models.map(model => options.readClassMembership(model)))
      const initialMemberships = membershipState()
      const execution = await executeAuditedNativeJev({ ...deps, session: request.input.rootSessionID }, async (client) => {
        try { return await selectJobClassModel(client, request, options) }
        catch (error) {
          if (error instanceof JobClassSelectionError && (["low_confidence", "classification_pending", "class_unavailable", "invalid_input"].includes(error.reason) || nativeJevFailureAdmission(error.cause))) {
            // Valid uncertainty/policy refusals retain paid stage receipts without
            // treating the provider as broken or opening its circuit breaker.
            throw new NativeJevAdmissionError(error.message)
          }
          throw error
        }
      }, { audit, beforeRequest: async () => {
        await deps.beforeRequest?.(request)
        if (membershipState() !== initialMemberships) throw new NativeJevAdmissionError("Catalog classification changed before the Jev request")
      } })
      return { ...execution.value, usage: execution.usage,
        source: { result: execution.value.source, httpAttempts: execution.attempts } }
    },
  }
}
