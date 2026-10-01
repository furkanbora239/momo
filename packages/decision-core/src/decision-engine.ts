import { createJevClient, type JevClient } from "./jev-client"
import {
  buildEffortQuestion,
  buildLaneQuestion,
  buildModelQuestion,
  buildPathQuestion,
} from "./schema"
import type {
  ChoiceAnswer,
  DecisionResult,
  DecisionTask,
  JevCallResult,
  ModelCandidate,
  PathOption,
  ScoreAnswer,
} from "./types"

export type { JevClient }

export interface BuildCandidatesContext {
  readonly path: string
  readonly effort: number
  readonly task: DecisionTask
}

export interface DecisionEngineDeps {
  readonly client: JevClient
  readonly buildCandidates: (
    ctx: BuildCandidatesContext,
  ) => readonly ModelCandidate[]
  readonly pathOptions: readonly PathOption[]
  readonly confidenceThreshold?: number
  readonly breakerFailures?: number
  readonly breakerCooldownMs?: number
  readonly now?: () => number
}

export interface DecisionEngine {
  decide(task: DecisionTask): Promise<DecisionResult>
}

const ZERO_USAGE = { inputTokens: 0, costUsd: 0 }

export function createDecisionEngine(
  deps: DecisionEngineDeps,
): DecisionEngine {
  const confidenceThreshold = deps.confidenceThreshold ?? 0.75
  const breakerFailures = deps.breakerFailures ?? 3
  const breakerCooldownMs = deps.breakerCooldownMs ?? 600_000
  const now = deps.now ?? Date.now

  let consecutiveFailures = 0
  let openUntil = 0

  const breakerOpen = (): boolean =>
    consecutiveFailures >= breakerFailures && now() < openUntil

  const recordFailure = (): void => {
    consecutiveFailures += 1
    if (consecutiveFailures >= breakerFailures) {
      openUntil = now() + breakerCooldownMs
    }
  }

  const recordSuccess = (): void => {
    consecutiveFailures = 0
  }

  const buildState = (task: DecisionTask): string =>
    `${task.prompt}\n\n${task.description}`

  async function decide(task: DecisionTask): Promise<DecisionResult> {
    if (breakerOpen()) {
      return {
        source: "fallback",
        reason: "breaker-open",
        candidates: [],
        resolved: {},
        usage: { ...ZERO_USAGE },
        latencyMs: 0,
      }
    }

    const state1 = buildState(task)
    let stage1: JevCallResult
    try {
      stage1 = await deps.client.ask(state1, {
        path: buildPathQuestion(deps.pathOptions),
        effort: buildEffortQuestion(),
      })
      recordSuccess()
    } catch {
      recordFailure()
      return {
        source: "fallback",
        reason: "jev-error",
        candidates: [],
        resolved: {},
        usage: { ...ZERO_USAGE },
        latencyMs: 0,
      }
    }

    const pathAnswer = stage1.answers.path as ChoiceAnswer
    const effortAnswer = stage1.answers.effort as ScoreAnswer

    if (pathAnswer.confidence < confidenceThreshold) {
      return {
        source: "fallback",
        reason: "low-confidence-stage1",
        stage1: { path: pathAnswer, effort: effortAnswer },
        candidates: [],
        resolved: {},
        usage: {
          inputTokens: stage1.usage.inputTokens,
          costUsd: stage1.costUsd,
        },
        latencyMs: stage1.latencyMs,
      }
    }

    const effort = Math.round(effortAnswer.score)
    const candidates = deps.buildCandidates({
      path: pathAnswer.choice,
      effort,
      task,
    })

    if (candidates.length === 0) {
      return {
        source: "fallback",
        reason: "no-candidates",
        stage1: { path: pathAnswer, effort: effortAnswer },
        candidates: [],
        resolved: {},
        usage: {
          inputTokens: stage1.usage.inputTokens,
          costUsd: stage1.costUsd,
        },
        latencyMs: stage1.latencyMs,
      }
    }

    const state2 =
      `${state1}\n\nCandidates:\n` +
      candidates
        .map((c) => `- ${c.name}: ${c.priceLine}; ${c.strength}`)
        .join("\n")

    let stage2: JevCallResult
    try {
      stage2 = await deps.client.ask(state2, {
        model: buildModelQuestion(candidates),
        lane: buildLaneQuestion(),
      })
      recordSuccess()
    } catch {
      recordFailure()
      return {
        source: "fallback",
        reason: "jev-error",
        stage1: { path: pathAnswer, effort: effortAnswer },
        candidates,
        resolved: { path: pathAnswer.choice, effort },
        usage: {
          inputTokens: stage1.usage.inputTokens,
          costUsd: stage1.costUsd,
        },
        latencyMs: stage1.latencyMs,
      }
    }

    const modelAnswer = stage2.answers.model as ChoiceAnswer
    const laneAnswer = stage2.answers.lane as ChoiceAnswer

    const summedUsage = {
      inputTokens: stage1.usage.inputTokens + stage2.usage.inputTokens,
      costUsd: stage1.costUsd + stage2.costUsd,
    }
    const summedLatency = stage1.latencyMs + stage2.latencyMs

    if (modelAnswer.confidence < confidenceThreshold) {
      return {
        source: "fallback",
        reason: "low-confidence-stage2",
        stage1: { path: pathAnswer, effort: effortAnswer },
        candidates,
        stage2: { model: modelAnswer, lane: laneAnswer },
        resolved: { path: pathAnswer.choice, effort },
        usage: summedUsage,
        latencyMs: summedLatency,
      }
    }

    return {
      source: "jev",
      stage1: { path: pathAnswer, effort: effortAnswer },
      candidates,
      stage2: { model: modelAnswer, lane: laneAnswer },
      resolved: {
        path: pathAnswer.choice,
        effort,
        model: modelAnswer.choice,
        lane: laneAnswer.choice,
      },
      usage: summedUsage,
      latencyMs: summedLatency,
    }
  }

  return { decide }
}
