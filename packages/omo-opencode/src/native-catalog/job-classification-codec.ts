import type { JevCallResult, JevQuestionSet } from "@oh-my-opencode/decision-core"
import { classificationObject, jobClassificationFingerprint, jobModelKey } from "./job-classification-identity"
import { isJobClassificationUsage } from "./job-classification-usage"
import type { JobClassDefinitions, JobClassificationInput, JobClassificationResult, JobClassificationUsageReceipt } from "./job-classification-types"

const MAX_BATCH_MODELS = 4
const MAX_BATCH_QUESTIONS = 32
const MAX_STATE_BYTES = 24_000
const SUITABILITY_CHOICES = new Set(["suitable", "unsuitable", "unknown"])

// Consolidate with decision-core's shared probability helper when accounting integration lands.
function validProbabilities(value: unknown, selected: string): boolean {
  if (!classificationObject(value) || !Object.hasOwn(value, selected) || Object.keys(value).length === 0) return false
  const entries = Object.entries(value)
  if (entries.some(([key, probability]) => !SUITABILITY_CHOICES.has(key) || typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1)) return false
  const total = entries.reduce((sum, [, probability]) => sum + Number(probability), 0)
  return Math.abs(total - 1) <= 0.01 + Number.EPSILON * 4
}

export interface JobClassificationBatch {
  readonly definitions: JobClassDefinitions
  readonly state: string
  readonly questions: JevQuestionSet
  readonly entries: readonly {
    readonly input: JobClassificationInput
    readonly fingerprint: string
    readonly questions: readonly { readonly key: string; readonly classId: string }[]
  }[]
}

/** Pure codec: caller supplies the pending slice and owns idle scheduling, policy and budget guards. */
export function createJobClassificationBatch(definitions: JobClassDefinitions, inputs: readonly JobClassificationInput[]): JobClassificationBatch {
  if (inputs.length === 0 || inputs.length > MAX_BATCH_MODELS || inputs.length * definitions.classes.length > MAX_BATCH_QUESTIONS) {
    throw new Error("classification batch exceeds bounded model/question limits")
  }
  const questions: JevQuestionSet = {}
  const entries = inputs.map((input, index) => ({
    input: structuredClone(input), fingerprint: jobClassificationFingerprint(definitions, input),
    questions: definitions.classes.map((entry, classIndex) => {
      const key = `m${index}c${classIndex}`
      questions[key] = {
        type: "choice", instructions: `Model ${index}; job class ${entry.id}.`,
        criteria: { suitable: "Source-backed traits support an inferred suitability recommendation", unsuitable: "Source-backed traits support an inferred unsuitability recommendation", unknown: "Insufficient evidence" },
      }
      return { key, classId: entry.id }
    }),
  }))
  if (new Set(inputs.map((input) => jobModelKey(input.model))).size !== inputs.length) throw new Error("duplicate classification model")
  const state = JSON.stringify({ version: 1, instructions: "Infer job suitability recommendations from the supplied verified traits and published model descriptions. A direct task benchmark or an explicit claim naming the job class is not required: consider what the stated language, reasoning, tool and modality capabilities can support. Text output supports language generation but alone does not prove skill in every text-based job. Native roles are independent. Return unknown when evidence is insufficient or irrelevant, and unsuitable when it contradicts the job requirements. Do not invent measured performance or promote recommendations into verified model facts.", definitions, models: entries.map((entry) => entry.input) })
  if (Buffer.byteLength(state, "utf8") > MAX_STATE_BYTES) throw new Error("classification evidence exceeds bounded state limit")
  return { definitions: structuredClone(definitions), state, questions, entries }
}

/** Caller must durably account the audited receipt before decode, including failed/malformed responses. */
export function decodeJobClassificationBatch(batch: JobClassificationBatch, result: JevCallResult, classifiedAt: string, receipt: JobClassificationUsageReceipt): JobClassificationResult {
  if (!isJobClassificationUsage(receipt) || !Number.isFinite(Date.parse(classifiedAt))) throw new Error("invalid classification receipt or timestamp")
  if (Object.keys(result.answers).length !== Object.keys(batch.questions).length) throw new Error("classification answer count mismatch")
  const profiles = batch.entries.map((entry) => ({
    model: entry.input.model, definitions: batch.definitions, evidence: entry.input.evidence, fingerprint: entry.fingerprint, provenance: "jev-recommendation" as const, classifiedAt,
    memberships: entry.questions.map(({ key, classId }) => {
      const answer = result.answers[key]
      if (!answer || answer.type !== "choice" || !SUITABILITY_CHOICES.has(answer.choice) ||
          !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
          !validProbabilities(answer.probabilities, answer.choice)) {
        throw new Error(`malformed classification answer: ${key}`)
      }
      const suitability = entry.input.evidence.some((evidence) => Object.keys(evidence.facts).length > 0)
        ? answer.choice as "suitable" | "unsuitable" | "unknown" : "unknown"
      return { classId, suitability, confidence: suitability === "unknown" ? 0 : answer.confidence }
    }),
  }))
  return { version: 1, profiles, usage: structuredClone(receipt) }
}
