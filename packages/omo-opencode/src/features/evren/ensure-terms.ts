import { log } from "../../shared/logger"
import { readEvrenConsentStatus, type EvrenConsentStatus } from "./consent"
import { acceptEvrenTerms, readEvrenApiKey } from "./terms"

type EvrenTermsEnsurerDeps = {
  readConsentStatus?: () => EvrenConsentStatus
  readApiKey?: () => string | undefined
  accept?: (params: { apiKey: string }) => Promise<{ ok: boolean }>
}

/**
 * Builds a once-per-process EVREN gateway ToS acceptor. The returned function
 * is a silent no-op until the user consented AND an API key exists; a failed
 * acceptance stays retryable on the next call.
 */
export function createEvrenTermsEnsurer(deps: EvrenTermsEnsurerDeps = {}) {
  const readConsentStatus = deps.readConsentStatus ?? readEvrenConsentStatus
  const readApiKey = deps.readApiKey ?? readEvrenApiKey
  const accept = deps.accept ?? acceptEvrenTerms

  let done = false

  return async function ensureEvrenTermsAccepted(): Promise<void> {
    if (done) return
    if (readConsentStatus() !== "accepted") return
    const key = readApiKey()
    if (!key) return
    try {
      const result = await accept({ apiKey: key })
      if (result.ok) {
        done = true
        log("[evren-terms] Gateway terms accepted silently")
      } else {
        log("[evren-terms] Gateway terms acceptance failed; retrying on next call")
      }
    } catch (error) {
      log("[evren-terms] Gateway terms acceptance error", { error: String(error) })
    }
  }
}

export const ensureEvrenTermsAccepted = createEvrenTermsEnsurer({
  readConsentStatus: readEvrenConsentStatus,
  readApiKey: readEvrenApiKey,
  accept: acceptEvrenTerms,
})
