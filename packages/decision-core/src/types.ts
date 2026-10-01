// Shared types for the Jev System One decision engine.

export interface PathOption {
  readonly name: string
  readonly description: string
}

export interface ModelCandidate {
  readonly name: string
  readonly priceLine: string
  readonly strength: string
}

export interface ChoiceQuestion {
  readonly type: "choice"
  readonly instructions: string
  readonly criteria: Record<string, string>
}

export interface ScoreQuestion {
  readonly type: "score"
  readonly instructions: string
  readonly criteria: readonly string[]
}

export interface NoulQuestion {
  readonly type: "noul"
  readonly instructions: string
}

export type JevQuestion =
  | ChoiceQuestion
  | ScoreQuestion
  | NoulQuestion

export type JevQuestionSet = Record<string, JevQuestion>

export interface ChoiceAnswer {
  readonly type: "choice"
  readonly choice: string
  readonly confidence: number
  readonly probabilities: Record<string, number>
}

export interface ScoreAnswer {
  readonly type: "score"
  readonly score: number
  readonly confidence: number
  readonly legend?: readonly string[]
  readonly probabilities?: Record<string, number>
}

export interface NoulAnswer {
  readonly type: "noul"
  readonly noul: number
  readonly confidence: number
}

export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer

export type JevAnswers = Record<string, JevAnswer>

export interface JevUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface JevCallResult {
  readonly model: string
  readonly answers: JevAnswers
  readonly usage: JevUsage
  readonly latencyMs: number
  readonly costUsd: number
}

export type PostJson = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
) => Promise<{ readonly status: number; readonly body: unknown }>

export type DecisionCoreErrorCode =
  | "invalid-question"
  | "http"
  | "jev-unavailable"

export class DecisionCoreError extends Error {
  readonly code: DecisionCoreErrorCode
  readonly status?: number

  constructor(code: DecisionCoreErrorCode, message: string, status?: number) {
    super(message)
    this.name = "DecisionCoreError"
    this.code = code
    this.status = status
  }
}

export interface DecisionTask {
  readonly description: string
  readonly prompt: string
}

export type DecisionFallbackReason =
  | "low-confidence-stage1"
  | "low-confidence-stage2"
  | "no-candidates"
  | "breaker-open"
  | "jev-error"

export interface DecisionResult {
  readonly source: "jev" | "fallback"
  readonly reason?: DecisionFallbackReason
  readonly stage1?: { readonly path: ChoiceAnswer; readonly effort: ScoreAnswer }
  readonly candidates: readonly ModelCandidate[]
  readonly stage2?: { readonly model: ChoiceAnswer; readonly lane: ChoiceAnswer }
  readonly resolved: {
    readonly path?: string
    readonly effort?: number
    readonly model?: string
    readonly lane?: string
  }
  readonly usage: { readonly inputTokens: number; readonly costUsd: number }
  readonly latencyMs: number
}
