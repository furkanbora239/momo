import { NativeJevUsageError } from "./jev-usage"
import { hasValidProbabilityMass } from "./probability-mass"
import type { JevCallResult, JevClient, JevQuestionSet } from "@oh-my-opencode/decision-core"
import type { NativeCandidate, NativeJevAnswer, NativeJevRequest } from "./types"

export const JEV_CHOICE_LIMIT = 255

const key = (candidate: NativeCandidate): string => `${candidate.role}|${candidate.model.providerID}/${candidate.model.id}`
export const nativeRoleDescriptions: Readonly<Record<string, string>> = {
  planner: "Readonly department lead: plans and delegates worker children; no shell or edits.",
  executor: "Readonly department lead: coordinates implementation through worker children; no shell or edits.",
  reviewer: "Readonly department lead: coordinates review through worker children; no shell or edits.",
  worker: "Direct implementation worker; can use shell/edit, cannot delegate.",
  explore: "Readonly repository exploration worker; cannot delegate.",
  librarian: "Readonly external research worker; cannot delegate.",
  research: "Readonly research worker; cannot delegate.",
  "catalog-researcher": "Readonly catalog research worker; cannot delegate.",
  advisor: "Readonly consultation only; cannot delegate or consult.",
}

export function candidateCriteria(candidates: readonly NativeCandidate[]): Record<string, string> {
  return Object.fromEntries(candidates.map((candidate) => {
    const { facts, model, knowledge } = candidate
    return [key(candidate), JSON.stringify({ role: candidate.role, model, pricesPerMillion: { input: facts.inputPricePerMillion ?? "unknown", output: facts.outputPricePerMillion ?? "unknown" }, priceCurrency: facts.priceCurrency ?? "unknown", priceOrigin: facts.priceOrigin ?? facts.priceSource ?? "unknown", contextLength: facts.contextLength ?? "unknown", toolCall: facts.toolCall ?? "unknown", capabilities: facts.capabilities ?? "unknown", knowledge: knowledge.known ? knowledge : "unknown" })]
  }))
}

export function validatedJevChoice(result: JevCallResult, name: string, criteria: Record<string, string>) {
  const answer = result.answers[name]
  if (!answer || answer.type !== "choice" || !Object.hasOwn(criteria, answer.choice) ||
    !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
    !answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) throw new Error(`malformed Jev ${name} response`)
  const entries = Object.entries(answer.probabilities)
  if (entries.length === 0 || entries.some(([entry, probability]) => !Object.hasOwn(criteria, entry) || !Number.isFinite(probability) || probability < 0 || probability > 1) ||
    !Object.hasOwn(answer.probabilities, answer.choice) || !hasValidProbabilityMass(entries.map(([, probability]) => probability))) throw new Error(`malformed Jev ${name} response`)
  return answer
}

/** Hierarchical conditional selection keeps every eligible model represented at each split. */
export async function stagedNativeAnswer(client: JevClient, request: NativeJevRequest): Promise<NativeJevAnswer> {
  const stages: { questionNames: string[]; result: JevCallResult }[] = []
  async function ask(questions: JevQuestionSet, context: Record<string, unknown> = {}) {
    const result = await client.ask(JSON.stringify({ decisionId: request.decisionId, input: request.input, allowedRoles: request.allowedRoles, outcomes: request.outcomes, instructions: request.instructions, selectionStage: context }), questions)
    stages.push({ questionNames: Object.keys(questions), result })
    return result
  }
  try {
    const roles = Object.fromEntries([...new Set(request.candidates.map((candidate) => candidate.role))].map((role) => [role, nativeRoleDescriptions[role] ?? role]))
    const lanes = { direct: "One selected role handles the task directly.", department: "A planner, executor, or reviewer lead coordinates worker children." }
    const roleResult = await ask({ role: { type: "choice", instructions: "Choose the role whose runtime permissions meet the request.", criteria: roles }, lane: { type: "choice", instructions: "Choose the lane compatible with the chosen role.", criteria: lanes } })
    const role = validatedJevChoice(roleResult, "role", roles)
    const lane = validatedJevChoice(roleResult, "lane", lanes)
    let confidence = Math.min(role.confidence, lane.confidence)
    let candidates = request.candidates.filter((candidate) => candidate.role === role.choice)
    while (candidates.length > JEV_CHOICE_LIMIT) {
      const size = Math.ceil(candidates.length / JEV_CHOICE_LIMIT)
      const groups = Array.from({ length: Math.ceil(candidates.length / size) }, (_, index) => candidates.slice(index * size, (index + 1) * size))
      const criteria = Object.fromEntries(groups.map((group, index) => [`group-${index}`, `[${Object.values(candidateCriteria(group)).join(",")}]`]))
      const result = await ask({ group: { type: "choice", instructions: "Choose the group containing the least costly adequate model. All models in each group are eligible; consider their full facts.", criteria } }, { role: role.choice, candidateCount: candidates.length })
      const selected = validatedJevChoice(result, "group", criteria)
      confidence = Math.min(confidence, selected.confidence)
      candidates = groups[Number(selected.choice.slice("group-".length))]!
    }
    const criteria = candidateCriteria(candidates)
    const result = await ask({ candidate: { type: "choice", instructions: "Choose the least costly model that can meet the request. Unknown price is not free, and unknown ability is not verified.", criteria } }, { role: role.choice, candidateCount: candidates.length })
    const selected = validatedJevChoice(result, "candidate", criteria)
    const candidate = candidates.find((item) => key(item) === selected.choice)!
    return {
      role: candidate.role, model: candidate.model, confidence: Math.min(confidence, selected.confidence), probabilities: selected.probabilities,
      lane: lane.choice as "direct" | "department", laneConfidence: lane.confidence,
      source: { contract: "hierarchical-conditional-v1", probabilityScope: "selected-role-and-group", stages },
      usage: { inputTokens: stages.reduce((sum, stage) => sum + stage.result.usage.inputTokens, 0), outputTokens: stages.reduce((sum, stage) => sum + stage.result.usage.outputTokens, 0), costUsd: stages.reduce((sum, stage) => sum + stage.result.costUsd, 0) },
    }
  } catch (error) {
    const usage = stages.length ? { inputTokens: stages.reduce((sum, stage) => sum + stage.result.usage.inputTokens, 0), outputTokens: stages.reduce((sum, stage) => sum + stage.result.usage.outputTokens, 0), costUsd: stages.reduce((sum, stage) => sum + stage.result.costUsd, 0) } : undefined
    throw new NativeJevUsageError(error, usage)
  }
}
