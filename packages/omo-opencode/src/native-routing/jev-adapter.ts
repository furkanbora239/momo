import { createJevClient, type JevCallResult, type JevClient, type JevClientDeps, type PostJson } from "@oh-my-opencode/decision-core"
import { candidateCriteria, JEV_CHOICE_LIMIT, stagedNativeAnswer } from "./jev-staged-selection"
import type { NativeJev, NativeJevAnswer, NativeJevHttpAttempt, NativeJevRequest } from "./types"

const candidateKey = (role: string, providerID: string, id: string): string => `${role}|${providerID}/${id}`


function decodeChoice(raw: JevCallResult["answers"][string] | undefined): {
  choice: string
  confidence: number
  probabilities: Record<string, number>
} {
  if (!raw || raw.type !== "choice") return { choice: "", confidence: 0, probabilities: {} }
  return { choice: raw.choice, confidence: raw.confidence, probabilities: raw.probabilities }
}

function decodeCandidate(choice: string, request: NativeJevRequest): NativeJevAnswer {
  const candidate = request.candidates.find((item) => candidateKey(item.role, item.model.providerID, item.model.id) === choice)
  return candidate
    ? { role: candidate.role, model: candidate.model, confidence: 0, probabilities: {} }
    : { role: "", model: { providerID: "", id: "" }, confidence: 0, probabilities: {} }
}

function questionsFor(request: NativeJevRequest) {
  return {
    candidate: {
      type: "choice" as const,
      instructions: "Choose the least costly role and model that can meet the request. Unknown price is not free, and unknown ability is not verified.",
      criteria: candidateCriteria(request.candidates),
    },
    lane: {
      type: "choice" as const,
      instructions: "Choose direct unless a planner, executor, or reviewer lead should coordinate worker children.",
      criteria: {
        direct: "One selected role handles the task directly.",
        department: "A planner, executor, or reviewer lead coordinates worker children.",
      },
    },
  }
}

function nativeAnswer(client: JevClient, request: NativeJevRequest): Promise<NativeJevAnswer> {
  if (request.candidates.length > JEV_CHOICE_LIMIT) return stagedNativeAnswer(client, request)
  return client.ask(JSON.stringify(request), questionsFor(request)).then((result) => {
    const candidateChoice = decodeChoice(result.answers.candidate)
    const lane = decodeChoice(result.answers.lane)
    const decoded = decodeCandidate(candidateChoice.choice, request)
    const laneValue = lane.choice === "department" || lane.choice === "direct" ? lane.choice : undefined
    return {
      ...decoded,
      confidence: candidateChoice.confidence,
      probabilities: candidateChoice.probabilities,
      lane: laneValue,
      laneConfidence: lane.confidence,
      source: { answers: result.answers, model: result.model, latencyMs: result.latencyMs },
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: result.costUsd },
    }
  })
}

export function createNativeJevAdapter(client: JevClient): NativeJev {
  return { choose: (request) => nativeAnswer(client, request) }
}

function parseResponseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export class NativeJevRequestError extends Error {
  readonly attempts: readonly NativeJevHttpAttempt[]

  constructor(error: unknown, attempts: readonly NativeJevHttpAttempt[]) {
    const message = error instanceof Error ? error.message : String(error)
    super(message, { cause: error })
    this.name = "NativeJevRequestError"
    this.attempts = attempts
  }
}

export function nativeJevFailureEvidence(error: unknown): unknown {
  return error instanceof NativeJevRequestError ? { httpAttempts: error.attempts } : undefined
}

function redactedHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) safe[key] = key.toLowerCase() === "authorization" ? "[redacted]" : value
  return safe
}

function createAuditedPostJson(
  deps: JevClientDeps,
  attempts: NativeJevHttpAttempt[],
): PostJson {
  return async (url, headers, body) => {
    const entry: { url: string; headers: Readonly<Record<string, string>>; requestBody: unknown; status?: number; responseBody?: unknown; error?: string } = {
      url,
      headers: redactedHeaders(headers),
      requestBody: body,
    }
    try {
      const result = deps.postJson
        ? await deps.postJson(url, headers, body)
        : await (async () => {
          const response = deps.fetchNow
            ? await deps.fetchNow()
            : await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
            })
          return { status: response.status, body: parseResponseBody(await response.text()) }
        })()
      const responseBody = result.body
      entry.status = result.status
      entry.responseBody = responseBody
      attempts.push(entry)
      return result
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
      attempts.push(entry)
      throw error
    }
  }
}

export function createNativeJevBackend(deps: JevClientDeps): NativeJev {
  return {
    async choose(request) {
      const attempts: NativeJevHttpAttempt[] = []
      const client = createJevClient({
        ...deps,
        session: request.input.rootSessionID,
        postJson: createAuditedPostJson(deps, attempts),
      })
      try {
        const answer = await nativeAnswer(client, request)
        return { ...answer, source: { result: answer.source, httpAttempts: attempts } }
      } catch (error) {
        throw new NativeJevRequestError(error, attempts)
      }
    },
  }
}
