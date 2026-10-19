// MODIFIED: momo serialized, bounded maintenance; no native task/form/worker execution.
import { randomUUID } from "node:crypto"
import { createJobClassificationBatch, decodeJobClassificationBatch, type JobClassificationBatch } from "./job-classification-codec"
import { jobClassificationFingerprint, jobModelKey } from "./job-classification-identity"
import { isJobClassificationUsage } from "./job-classification-usage"
import { createClassificationExecutorState } from "./job-classification-executor-state"
import { JobClassificationNoSendError } from "./job-classification-executor-types"
import type { JobClassificationExecutorOptions, JobClassificationExecutorStatus } from "./job-classification-executor-types"
import type { JobClassificationInput } from "./job-classification-types"

export function createJobClassificationExecutor(options: JobClassificationExecutorOptions) {
  const persistence = createClassificationExecutorState(options.statePath)
  const state = persistence.load()
  let active: Promise<JobClassificationExecutorStatus> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined, background = false
  // An interrupted paid attempt is ambiguous; never replay it on restart automatically.
  for (const entry of Object.values(state.entries)) if (entry.state === "inflight") { entry.state = "failed"; entry.reason = "Interrupted audited attempt requires explicit retry" }
  const revision = () => options.currentRevision?.() ?? ""
  function status(): JobClassificationExecutorStatus {
    const entries = Object.values(state.entries), count = (name: string) => entries.filter(entry => entry.state === name).length
    return { queued: count("queued"), inflight: count("inflight"), failed: count("failed"), paused: count("paused"), batches: state.batches, completedProfiles: state.completedProfiles, staleProfiles: state.staleProfiles, ...(state.lastReceiptID === undefined ? {} : { lastReceiptID: state.lastReceiptID }), ...(entries.find(entry => entry.state === "paused")?.reason ? { pauseReason: entries.find(entry => entry.state === "paused")!.reason } : {}), running: active !== undefined, backgroundRunning: background, ...(state.lastError === undefined ? {} : { lastError: state.lastError }) }
  }
  function recordFailure(error: unknown): void {
    state.lastError = String(error)
    try { persistence.save(state) }
    catch (storageError) { state.lastError += "; diagnostic persistence failed: " + String(storageError) }
  }
  async function refresh() {
    const definitions = await options.currentDefinitions(), inputs = await options.getInputs()
    const pending = options.profileStore.pending(definitions, inputs, inputs.length), keys = new Set<string>()
    for (const input of pending) {
      const key = jobModelKey(input.model), fingerprint = jobClassificationFingerprint(definitions, input); keys.add(key)
      const entry = state.entries[key]
      if (!entry || entry.fingerprint !== fingerprint) state.entries[key] = { fingerprint, state: "queued", revision: revision() }
      else if (entry.state === "paused" && entry.revision !== revision()) state.entries[key] = { fingerprint, state: "queued", revision: revision() }
    }
    for (const key of Object.keys(state.entries)) if (!keys.has(key)) delete state.entries[key]
    persistence.save(state)
    return { definitions, pending }
  }
  async function run(): Promise<void> {
    const { definitions, pending } = await refresh(), selected: JobClassificationInput[] = []
    const limit = Math.min(4, Math.floor(32 / definitions.classes.length))
    let batch: JobClassificationBatch | undefined
    for (const input of pending) {
      const entry = state.entries[jobModelKey(input.model)]!
      if (entry.state !== "queued") continue
      const eligibilityRevision = revision()
      if (!await options.isEligible(input)) { entry.state = "paused"; entry.reason = "Model is currently ineligible"; entry.revision = eligibilityRevision; continue }
      try { createJobClassificationBatch(definitions, [input]) }
      catch (error) { entry.state = "failed"; entry.reason = String(error); continue }
      if (selected.length >= limit) break
      try { batch = createJobClassificationBatch(definitions, [...selected, input]); selected.push(input) }
      catch (error) { if (selected.length === 0) { entry.state = "failed"; entry.reason = String(error) }; break }
    }
    persistence.save(state)
    if (!batch) return
    const admissionRevision = revision()
    const admission = await options.admission?.()
    if (admission && !admission.allowed) {
      for (const item of batch.entries) { const entry = state.entries[jobModelKey(item.input.model)]!; entry.state = "paused"; entry.reason = admission.reason; entry.revision = admissionRevision }
      persistence.save(state); return
    }
    // Re-read mutable source facts and permissions after all asynchronous preparation.
    const current = await options.getInputs(), currentDefinitions = await options.currentDefinitions()
    for (const item of batch.entries) {
      const match = current.find(input => jobModelKey(input.model) === jobModelKey(item.input.model))
      if (!match || jobClassificationFingerprint(currentDefinitions, match) !== item.fingerprint || !await options.isEligible(match)) { await refresh(); return }
    }
    const intentID = randomUUID(), attemptRevision = revision()
    for (const item of batch.entries) { const entry = state.entries[jobModelKey(item.input.model)]!; entry.state = "inflight"; entry.intentID = intentID }
    state.batches++; persistence.save(state)
    try {
      const audited = await options.executeAudited({ batch, intentID })
      // Receipt/HTTP durability is an explicit contract of executeAudited, not codec success.
      if (!isJobClassificationUsage(audited.receipt)) throw new Error("Audited classification receipt is malformed")
      state.lastReceiptID = audited.receipt.receiptID; persistence.save(state)
      const decoded = decodeJobClassificationBatch(batch, audited.result, new Date((options.now ?? Date.now)()).toISOString(), audited.receipt)
      const latest = await refresh(), profiles = []
      for (const profile of decoded.profiles) {
        const match = latest.pending.find(input => jobModelKey(input.model) === jobModelKey(profile.model))
        if (!match || !await options.isEligible(match) || jobClassificationFingerprint(latest.definitions, match) !== profile.fingerprint) { state.staleProfiles++; continue }
        profiles.push(profile)
      }
      if (profiles.length) { options.profileStore.save({ ...decoded, profiles }); state.completedProfiles += profiles.length }
      for (const item of batch.entries) {
        const key = jobModelKey(item.input.model), entry = state.entries[key]
        if (entry?.fingerprint !== item.fingerprint) continue
        if (profiles.some(profile => jobModelKey(profile.model) === key)) delete state.entries[key]
        else { entry.state = "paused"; entry.reason = "Response became ineligible or stale"; entry.revision = revision() }
      }
    } catch (error) {
      for (const item of batch.entries) { const entry = state.entries[jobModelKey(item.input.model)]; if (entry?.fingerprint === item.fingerprint) { entry.state = error instanceof JobClassificationNoSendError ? "paused" : "failed"; entry.reason = String(error); entry.revision = attemptRevision } }
      if (!(error instanceof JobClassificationNoSendError)) recordFailure(error)
    }
    persistence.save(state)
  }
  function pump(): Promise<JobClassificationExecutorStatus> {
    if (active) return active
    active = run().then(() => { active = undefined; return status() }, error => { active = undefined; recordFailure(error); throw error })
    return active
  }
  function retry(): void {
    if (active) throw new Error("Cannot retry classifications during an active pump")
    for (const entry of Object.values(state.entries)) if (entry.state === "failed" || entry.state === "paused") { entry.state = "queued"; delete entry.reason; entry.revision = revision() }
    persistence.save(state)
  }
  function start(intervalMs = 1000): void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100) throw new Error("classification interval must be at least 100ms")
    if (background) return
    background = true
    const schedule = () => {
      if (!background) return
      timer = setTimeout(() => { void pump().catch(() => { background = false }).finally(schedule) }, intervalMs); timer.unref?.()
    }
    schedule()
  }
  async function stop(): Promise<void> { background = false; if (timer) clearTimeout(timer); await active }
  return { pump, retry, status, start, stop }
}
