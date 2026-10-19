// MODIFIED: momo job suitability is selected before native execution role and model.
import type { JevCallResult, JevClient, JevQuestionSet } from "@oh-my-opencode/decision-core"
import type { JobClassDefinitions, JobClassificationProfile } from "../native-catalog/job-classification-types"
import { candidateCriteria, JEV_CHOICE_LIMIT, nativeRoleDescriptions, validatedJevChoice } from "./jev-staged-selection"
import { allowedRoles } from "./role-policy"
import type { NativeCandidate, NativeJevAnswer, NativeJevRequest, NativeModelRef } from "./types"

export interface JobClassSelectionOptions {
  readonly definitions: JobClassDefinitions
  /** Trusted lookup must use profileStore.read with current definitions and source fingerprint.
   * Missing/stale profiles return undefined. This adapter never classifies models. */
  readonly readClassMembership: (model: NativeModelRef) => JobClassificationProfile["memberships"] | undefined
  readonly confidenceThreshold?: number
}
export interface JobClassSelectionStage {
  readonly state: string
  readonly questions: JevQuestionSet
  readonly result?: JevCallResult
  readonly error?: string
}
export class JobClassSelectionError extends Error {
  constructor(readonly reason: "classification_pending" | "class_unavailable" | "invalid_input" | "low_confidence" | "selection_failed", message: string,
    readonly stages: readonly JobClassSelectionStage[], options?: ErrorOptions) {
    super(message, options)
    this.name = "JobClassSelectionError"
  }
}
export interface JobClassSelectionAnswer extends NativeJevAnswer {
  readonly jobClass: string
  readonly classificationProvenance: "jev-recommendation"
}
const modelKey = (model: NativeModelRef) => JSON.stringify([model.providerID, model.id])
const candidateKey = (candidate: NativeCandidate) => `${candidate.role}|${candidate.model.providerID}/${candidate.model.id}`
const departmentRoles = new Set(["planner", "executor", "reviewer"])

/** Pure protocol adapter. HTTP attempt auditing/budget admission belong to the injected backend.
 * It never infers zero spend from JevClient defaults; failed stages retain semantic evidence. */
export async function selectJobClassModel(client: JevClient, request: NativeJevRequest, options: JobClassSelectionOptions): Promise<JobClassSelectionAnswer> {
  const stages: JobClassSelectionStage[] = []
  const threshold = options.confidenceThreshold ?? 0.75
  const definitions = options.definitions
  const fail = (reason: JobClassSelectionError["reason"], message: string): never => { throw new JobClassSelectionError(reason, message, [...stages]) }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 || definitions.classes.length === 0 || definitions.classes.length > JEV_CHOICE_LIMIT ||
    definitions.classes.some((entry) => !entry.id.trim() || !entry.description.trim()) || new Set(definitions.classes.map((entry) => entry.id)).size !== definitions.classes.length) {
    fail("invalid_input", "Invalid job class definitions or confidence threshold; no Jev request sent")
  }
  // Eligibility was established by the caller; intersect role and current availability defensively.
  const permittedRoles = allowedRoles(request.input)
  const candidates = [...new Map(request.candidates.filter((candidate) => candidate.facts.available && permittedRoles.includes(candidate.role) && request.allowedRoles.includes(candidate.role) &&
    (request.input.requiredRole === undefined || request.input.requiredRole === candidate.role)).map((candidate) => [candidateKey(candidate), candidate])).values()]
  const memberships = new Map<string, JobClassificationProfile["memberships"] | undefined>()
  for (const candidate of candidates) {
    const key = modelKey(candidate.model)
    if (!memberships.has(key)) memberships.set(key, options.readClassMembership(candidate.model))
  }
  const belongs = (candidate: NativeCandidate, classId: string) => memberships.get(modelKey(candidate.model))?.some((tag) =>
    tag.classId === classId && tag.suitability === "suitable" && Number.isFinite(tag.confidence) && tag.confidence >= threshold && tag.confidence <= 1) === true
  const classes = definitions.classes.map((entry) => ({ ...entry, eligibleModelCount: new Set(candidates.filter((candidate) => belongs(candidate, entry.id)).map((candidate) => modelKey(candidate.model))).size }))
  if (!candidates.length) fail("class_unavailable", "No currently eligible role/model candidates; no Jev request sent")
  if (classes.every((entry) => entry.eligibleModelCount === 0)) {
    const pending = [...memberships.values()].some((tags) => tags === undefined || tags.some((tag) => tag.suitability === "unknown" ||
      (tag.suitability === "suitable" && (!Number.isFinite(tag.confidence) || tag.confidence < threshold))))
    fail(pending ? "classification_pending" : "class_unavailable", pending
      ? "No confident suitable cached job memberships; classification pending, no Jev request sent"
      : "No suitable eligible models in the configured job classes; no Jev request sent")
  }
  const brief = { prompt: request.input.prompt, scope: request.input.scope, acceptance: request.input.acceptance }
  let confidence = 1
  async function ask(state: Record<string, unknown>, questions: JevQuestionSet) {
    const serialized = JSON.stringify(state)
    try {
      const result = await client.ask(serialized, questions)
      stages.push({ state: serialized, questions, result })
      return result
    } catch (error) {
      stages.push({ state: serialized, questions, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  function select(result: JevCallResult, name: string, criteria: Record<string, string>) {
    const answer = validatedJevChoice(result, name, criteria)
    confidence = Math.min(confidence, answer.confidence)
    if (answer.confidence < threshold) fail("low_confidence", `Low confidence at ${name}; caller selection required`)
    return answer
  }
  try {
    // No spread of request here: knowledge/outcomes/instructions may contain model identities.
    const classCriteria = Object.fromEntries(definitions.classes.map((entry) => [entry.id, entry.description]))
    const classResult = await ask({ brief, classes: definitions.classes }, { jobClass: { type: "choice", instructions: "Choose the job class matching the task, independently of runtime role.", criteria: classCriteria } })
    const jobClass = select(classResult, "jobClass", classCriteria).choice
    const classCandidates = candidates.filter((candidate) => belongs(candidate, jobClass))
    if (classCandidates.length === 0) {
      const pending = [...memberships.values()].some((tags) => tags === undefined || tags.some((tag) => tag.classId === jobClass &&
        (tag.suitability === "unknown" || tag.suitability === "suitable" && tag.confidence < threshold)))
      fail(pending ? "classification_pending" : "class_unavailable", `No confident suitable eligible models for selected job class ${jobClass}`)
    }
    const roleRows = [...new Set(classCandidates.map((candidate) => candidate.role))].map((role) => ({ role,
      permissions: nativeRoleDescriptions[role] ?? role,
      eligibleModelCount: classCandidates.filter((candidate) => candidate.role === role).length }))
    const roles = Object.fromEntries(roleRows.map((row) => [row.role, row.permissions]))
    const lanes = { direct: "Selected role handles work directly.", department: "Planner, executor or reviewer coordinates worker children." }
    const roleResult = await ask({ brief, jobClass, roles: roleRows }, {
      role: { type: "choice", instructions: "Choose the native role whose existing permissions meet the task.", criteria: roles },
      lane: { type: "choice", instructions: "Choose department only for planner, executor or reviewer; all other roles use direct.", criteria: lanes },
    })
    const role = select(roleResult, "role", roles).choice
    const lane = select(roleResult, "lane", lanes)
    if ((lane.choice === "department") !== departmentRoles.has(role)) fail("selection_failed", "Jev role and lane are incompatible")
    let selectedCandidates = classCandidates.filter((candidate) => candidate.role === role)
    while (selectedCandidates.length > JEV_CHOICE_LIMIT) {
      const size = Math.ceil(selectedCandidates.length / JEV_CHOICE_LIMIT)
      const groups = Array.from({ length: Math.ceil(selectedCandidates.length / size) }, (_, index) => selectedCandidates.slice(index * size, (index + 1) * size))
      const criteria = Object.fromEntries(groups.map((group, index) => [`group-${index}`, `[${Object.values(candidateCriteria(group)).join(",")}]`]))
      const result = await ask({ brief, jobClass, role, candidateCount: selectedCandidates.length }, { group: {
        type: "choice", instructions: "Choose the group containing the least costly adequate model; all eligible class members are represented.", criteria,
      } })
      selectedCandidates = groups[Number(select(result, "group", criteria).choice.slice("group-".length))]!
    }
    const criteria = candidateCriteria(selectedCandidates)
    const result = await ask({ brief, jobClass, role }, { candidate: {
      type: "choice", instructions: "Choose the least costly adequate model. Unknown prices are not free; suitability recommendations are not verified abilities.", criteria,
    } })
    const selected = select(result, "candidate", criteria)
    const candidate = selectedCandidates.find((entry) => candidateKey(entry) === selected.choice)!
    return { jobClass, classificationProvenance: "jev-recommendation", role: candidate.role, model: candidate.model,
      confidence, probabilities: selected.probabilities, lane: lane.choice as "direct" | "department", laneConfidence: lane.confidence,
      source: { contract: "job-class-role-model-v1", probabilityScope: "selected-class-role-and-group", definitionsVersion: definitions.version,
        classifierVersion: definitions.classifierVersion, stages },
    }
  } catch (error) {
    if (error instanceof JobClassSelectionError) throw error
    throw new JobClassSelectionError("selection_failed", error instanceof Error ? error.message : String(error), [...stages], { cause: error })
  }
}
