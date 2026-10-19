import { describe, expect, test } from "bun:test"
import { executeAuditedNativeJev, NativeJevRequestError } from "./jev-adapter"
import type { NativeJevHttpAttempt } from "./types"

const questions = { pick: { type: "choice" as const, instructions: "Choose", criteria: { yes: "Yes" } } }
const body = { answers: { pick: { type: "choice", choice: "yes", confidence: 1, probabilities: { yes: 1 } } }, usage: { input_tokens: 100, output_tokens: 999 } }
const deps = { session: "isolated-test", getApiKey: () => "fake", maxAttempts: 1, postJson: async () => ({ status: 200, body }) }

describe("shared Jev transport audit boundary", () => {
  test("persists raw paid usage before semantic decoder failure", async () => {
    const observations: string[] = []
    const attempts: NativeJevHttpAttempt[] = []
    let caught: unknown
    try {
      await executeAuditedNativeJev(deps, async (client) => {
        await client.ask("state", questions)
        observations.push("decode")
        throw new Error("malformed semantic answer")
      }, { audit: {
        beforeRequest: () => { observations.push("admit") },
        recordAttempt: (attempt) => { observations.push("persist"); attempts.push(attempt) },
      } })
    } catch (error) { caught = error }
    expect(observations).toEqual(["admit", "persist", "decode"])
    expect(attempts).toHaveLength(1)
    expect(caught).toBeInstanceOf(NativeJevRequestError)
    const failure = caught as NativeJevRequestError
    expect(failure.usage?.inputTokens).toBe(100)
    expect(failure.usage?.costUsd).toBeCloseTo(0.0000042, 12)
    expect(failure.notSent).toBe(false)
  })
  test("storage failure does not duplicate the HTTP attempt or expose response to decoder", async () => {
    let decoded = false
    let records = 0
    let caught: unknown
    try {
      await executeAuditedNativeJev(deps, async (client) => {
        await client.ask("state", questions)
        decoded = true
      }, { audit: { beforeRequest: () => undefined, recordAttempt: () => { records += 1; throw new Error("disk full") } } })
    } catch (error) { caught = error }
    expect(decoded).toBe(false)
    expect(records).toBe(1)
    expect(caught).toBeInstanceOf(NativeJevRequestError)
    expect((caught as NativeJevRequestError).attempts).toHaveLength(1)
    expect((caught as NativeJevRequestError).usage?.inputTokens).toBe(100)
  })
  test("admission failure sends no request and creates no fake receipt", async () => {
    let sends = 0
    let records = 0
    let caught: unknown
    try {
      await executeAuditedNativeJev({ ...deps, postJson: async () => { sends += 1; return { status: 200, body } } },
        (client) => client.ask("state", questions), { audit: {
          beforeRequest: () => { throw new Error("provider disabled") },
          recordAttempt: () => { records += 1 },
        } })
    } catch (error) { caught = error }
    expect(sends).toBe(0)
    expect(records).toBe(0)
    expect(caught).toBeInstanceOf(NativeJevRequestError)
    expect((caught as NativeJevRequestError).notSent).toBe(true)
    expect((caught as NativeJevRequestError).usage).toBeUndefined()
  })
})
