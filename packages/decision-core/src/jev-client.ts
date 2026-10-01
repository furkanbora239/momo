import {
  DecisionCoreError,
  type JevAnswers,
  type JevCallResult,
  type JevQuestionSet,
  type PostJson,
} from "./types"

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1"
const DEFAULT_MODEL = "jev-1.13"
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [3000, 6000, 12000]
const DEFAULT_MAX_ATTEMPTS = 5
const INPUT_PRICE_PER_MILLION = 0.042

const USER_AGENT = "momo-decision-core/1.0 (opencode client)"

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function bodyExcerpt(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return text.length > 300 ? text.slice(0, 300) : text
}

function isRetryableStatus(status: number): boolean {
  return status === 422 || status === 429 || status === 529
}

function validateQuestions(questions: JevQuestionSet): void {
  for (const question of Object.values(questions)) {
    const raw = question as unknown as Record<string, unknown>
    if ("options" in raw && Array.isArray(raw.options)) {
      throw new DecisionCoreError(
        "invalid-question",
        "criteria-dict required; options arrays are rejected upstream",
      )
    }
    if (question.type === "choice") {
      const criteria = (question as { criteria?: unknown }).criteria
      if (
        typeof criteria !== "object" ||
        criteria === null ||
        Array.isArray(criteria)
      ) {
        throw new DecisionCoreError(
          "invalid-question",
          "criteria-dict required; options arrays are rejected upstream",
        )
      }
    }
  }
}

interface RawAnswer {
  readonly type?: string
  readonly choice?: string
  readonly confidence?: number
  readonly probabilities?: Record<string, number>
  readonly score?: number
  readonly legend?: readonly string[]
  readonly noul?: number
}

function mapAnswer(value: RawAnswer): JevCallResult["answers"][string] {
  const type = value.type
  if (type === "choice") {
    return {
      type: "choice",
      choice: value.choice ?? "",
      confidence: value.confidence ?? 0,
      probabilities: value.probabilities ?? {},
    }
  }
  if (type === "score") {
    return {
      type: "score",
      score: value.score ?? 0,
      confidence: value.confidence ?? 0,
      legend: value.legend,
      probabilities: value.probabilities,
    }
  }
  if (type === "noul") {
    return {
      type: "noul",
      noul: value.noul ?? 0,
      confidence: value.confidence ?? 0,
    }
  }
  // Tolerate answers missing an explicit type by inferring from shape.
  if (value.choice !== undefined) {
    return {
      type: "choice",
      choice: value.choice ?? "",
      confidence: value.confidence ?? 0,
      probabilities: value.probabilities ?? {},
    }
  }
  if (value.score !== undefined) {
    return {
      type: "score",
      score: value.score ?? 0,
      confidence: value.confidence ?? 0,
      legend: value.legend,
      probabilities: value.probabilities,
    }
  }
  return {
    type: "noul",
    noul: value.noul ?? 0,
    confidence: value.confidence ?? 0,
  }
}

function parseSuccess(
  model: string,
  body: unknown,
  latencyMs: number,
): JevCallResult {
  const raw = body as {
    answers?: Record<string, RawAnswer>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const answersRaw = raw.answers ?? {}
  const answers: JevAnswers = {}
  for (const [key, value] of Object.entries(answersRaw)) {
    answers[key] = mapAnswer(value)
  }
  const usageRaw = raw.usage ?? {}
  const inputTokens = usageRaw.input_tokens ?? 0
  const outputTokens = usageRaw.output_tokens ?? 0
  const costUsd = (inputTokens * INPUT_PRICE_PER_MILLION) / 1_000_000
  return {
    model,
    answers,
    usage: { inputTokens, outputTokens },
    latencyMs,
    costUsd,
  }
}

export interface JevClientDeps {
  readonly baseUrl?: string
  readonly model?: string
  readonly session: string
  readonly getApiKey: () => Promise<string> | string
  readonly postJson?: PostJson
  readonly timeoutMs?: number
  readonly retryDelaysMs?: readonly number[]
  readonly maxAttempts?: number
  readonly fetchNow?: () => Promise<Response>
}

export interface JevClient {
  ask(state: string, questions: JevQuestionSet): Promise<JevCallResult>
}

function createDefaultPostJson(deps: {
  readonly timeoutMs: number
  readonly fetchNow?: () => Promise<Response>
}): PostJson {
  return async (url, headers, body) => {
    const fetchNow =
      deps.fetchNow ??
      (() => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
        return fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer))
      })
    const response = await fetchNow()
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { status: response.status, body: parsed }
  }
}

export function createJevClient(deps: JevClientDeps): JevClient {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL
  const model = deps.model ?? DEFAULT_MODEL
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const postJson = deps.postJson ?? createDefaultPostJson({ timeoutMs, fetchNow: deps.fetchNow })

  async function ask(
    state: string,
    questions: JevQuestionSet,
  ): Promise<JevCallResult> {
    validateQuestions(questions)

    let lastStatus: number | undefined
    let lastBody: unknown
    const startedAt = Date.now()

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${await deps.getApiKey()}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "x-opencode-session": deps.session,
        }
        const { status, body } = await postJson(
          `${baseUrl}/systemone`,
          headers,
          { model, state, questions },
        )
        const latencyMs = Date.now() - startedAt

        if (status === 200) {
          return parseSuccess(model, body, latencyMs)
        }

        lastStatus = status
        lastBody = body

        if (isRetryableStatus(status)) {
          if (attempt >= maxAttempts) {
            throw new DecisionCoreError(
              "jev-unavailable",
              `jev-unavailable: exhausted ${maxAttempts} attempts (last status ${status})`,
              lastStatus,
            )
          }
          const delay =
            retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0
          await sleep(delay)
          continue
        }

        throw new DecisionCoreError(
          "http",
          `jev http error ${status}: ${bodyExcerpt(body)}`,
          status,
        )
      } catch (error) {
        if (error instanceof DecisionCoreError) throw error

        lastStatus = undefined
        lastBody = undefined

        if (attempt >= maxAttempts) {
          throw new DecisionCoreError(
            "jev-unavailable",
            `jev-unavailable: exhausted ${maxAttempts} attempts (transport error)`,
            lastStatus,
          )
        }
        const delay =
          retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0
        await sleep(delay)
      }
    }

    throw new DecisionCoreError(
      "jev-unavailable",
      `jev-unavailable: exhausted ${maxAttempts} attempts (last status ${lastStatus ?? "unknown"})`,
      lastStatus,
    )
  }

  return { ask }
}
