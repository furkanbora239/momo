import { describe, it, expect } from "bun:test"
import { createJevClient } from "./jev-client"
import { DecisionCoreError } from "./types"
import type {
  ChoiceAnswer,
  JevCallResult,
  JevQuestionSet,
  PostJson,
  ScoreAnswer,
} from "./types"

const okResponse = (
  answers: unknown,
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 480,
    output_tokens: 10,
  },
) => ({ status: 200, body: { answers, usage } })

describe("createJevClient", () => {
  it("rejects options-array questions before any network call", async () => {
    let called = false
    const postJson: PostJson = async () => {
      called = true
      return okResponse({})
    }
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
    })
    const bad = {
      q: { type: "choice", instructions: "x", options: ["a", "b"] },
    } as unknown as JevQuestionSet

    const error = await client.ask("state", bad).catch((e) => e)

    expect(error).toBeInstanceOf(DecisionCoreError)
    expect((error as DecisionCoreError).code).toBe("invalid-question")
    expect(called).toBe(false)
  })

  it("sends required headers including UA, session, and bearer key", async () => {
    let captured: Record<string, string> = {}
    const postJson: PostJson = async (_url, headers) => {
      captured = headers
      return okResponse({})
    }
    const client = createJevClient({
      session: "sess-123",
      getApiKey: () => "secret-key",
      postJson,
    })

    await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    })

    expect(captured["User-Agent"]).toBe(
      "momo-decision-core/1.0 (opencode client)",
    )
    expect(captured["x-opencode-session"]).toBe("sess-123")
    expect(captured["Authorization"]).toBe("Bearer secret-key")
    expect(captured["Content-Type"]).toBe("application/json")
  })

  it("retries on 422 then succeeds", async () => {
    let calls = 0
    const postJson: PostJson = async () => {
      calls += 1
      if (calls === 1) return { status: 422, body: { error: "bad" } }
      return okResponse({})
    }
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
      retryDelaysMs: [0, 0, 0],
    })

    const result = await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    })

    expect(result.model).toBe("jev-1.13")
    expect(calls).toBe(2)
  })

  it("throws http on non-retryable 400 without retry", async () => {
    let calls = 0
    const postJson: PostJson = async () => {
      calls += 1
      return { status: 400, body: { error: "nope" } }
    }
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
      retryDelaysMs: [0, 0, 0],
    })

    const error = await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    }).catch((e) => e)

    expect(error).toBeInstanceOf(DecisionCoreError)
    expect((error as DecisionCoreError).code).toBe("http")
    expect((error as DecisionCoreError).status).toBe(400)
    expect(calls).toBe(1)
  })

  it("throws jev-unavailable after exhausting attempts", async () => {
    let calls = 0
    const postJson: PostJson = async () => {
      calls += 1
      return { status: 422, body: {} }
    }
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
      retryDelaysMs: [0, 0, 0],
      maxAttempts: 5,
    })

    const error = await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    }).catch((e) => e)

    expect(error).toBeInstanceOf(DecisionCoreError)
    expect((error as DecisionCoreError).code).toBe("jev-unavailable")
    expect(calls).toBe(5)
  })

  it("throws jev-unavailable on persistent transport error", async () => {
    let calls = 0
    const postJson: PostJson = async () => {
      calls += 1
      throw new Error("network down")
    }
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
      retryDelaysMs: [0, 0, 0],
      maxAttempts: 3,
    })

    const error = await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    }).catch((e) => e)

    expect(error).toBeInstanceOf(DecisionCoreError)
    expect((error as DecisionCoreError).code).toBe("jev-unavailable")
    expect(calls).toBe(3)
  })

  it("computes costUsd from input tokens", async () => {
    const postJson: PostJson = async () =>
      okResponse({}, { input_tokens: 480, output_tokens: 0 })
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
    })

    const result = await client.ask("state", {
      q: { type: "noul", instructions: "x" },
    })

    expect(result.usage.inputTokens).toBe(480)
    expect(result.costUsd).toBeCloseTo((480 * 0.042) / 1_000_000, 12)
  })

  it("maps typed answers from the response", async () => {
    const postJson: PostJson = async () =>
      okResponse({
        path: {
          type: "choice",
          choice: "direct-worker",
          confidence: 0.9,
          probabilities: { "direct-worker": 0.9, department: 0.1 },
        },
        effort: {
          type: "score",
          score: 3,
          confidence: 0.8,
          legend: [
            "1 - trivial",
            "2 - small",
            "3 - moderate",
            "4 - large",
            "5 - very hard",
          ],
        },
      })
    const client = createJevClient({
      session: "s",
      getApiKey: () => "k",
      postJson,
    })

    const result = await client.ask("state", {
      path: { type: "choice", instructions: "x", criteria: { a: "b" } },
      effort: { type: "score", instructions: "y", criteria: ["1"] },
    })

    const path = result.answers.path as ChoiceAnswer
    const effort = result.answers.effort as ScoreAnswer
    expect(path.type).toBe("choice")
    expect(path.choice).toBe("direct-worker")
    expect(path.probabilities["department"]).toBe(0.1)
    expect(effort.type).toBe("score")
    expect(effort.score).toBe(3)
    expect(effort.legend?.[2]).toBe("3 - moderate")
  })
})
