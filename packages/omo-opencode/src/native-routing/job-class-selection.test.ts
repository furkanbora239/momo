import { describe, expect, test } from "bun:test"
import type { JevCallResult, JevClient, JevQuestionSet } from "@oh-my-opencode/decision-core"
import { JobClassSelectionError, selectJobClassModel, type JobClassSelectionOptions } from "./job-class-selection"
import type { NativeCandidate, NativeJevRequest, NativeRole } from "./types"

const definitions = { version: "1", classifierVersion: "1", classes: [
  { id: "coding", description: "Software implementation" }, { id: "research", description: "Source investigation" },
] }
const tag = (classId: string, confidence = 0.95, suitability: "suitable" | "unknown" | "unsuitable" = "suitable") => ({ classId, confidence, suitability })
function candidate(id: string, role: NativeRole = "worker"): NativeCandidate {
  const model = { providerID: "PRIVATE_PROVIDER", id }
  return { model, role, facts: { ...model, available: true, inputPricePerMillion: 1 }, knowledge: { model, known: true, summary: "PRIVATE_FACTS" } }
}
function request(candidates: NativeCandidate[]): NativeJevRequest {
  return { decisionId: "PRIVATE_DECISION", input: { prompt: "Investigate the problem", rootSessionID: "PRIVATE_ROOT", parentSessionID: "PRIVATE_PARENT", parentRole: "orchestrator", kind: "task" },
    allowedRoles: ["worker", "research", "planner"], candidates, knowledge: candidates.map((entry) => entry.knowledge), outcomes: [], instructions: "PRIVATE_INSTRUCTIONS" }
}
function fixture(options: { jobClass?: string; role?: string; target?: string; invalid?: string; low?: string; total?: number; reject?: number; adequacy?: string; weakAdequacy?: boolean; weakFirstAdequacy?: boolean; contradictoryAdequacy?: boolean } = {}) {
  const calls: { state: string; questions: JevQuestionSet }[] = []
  let adequacyCalls = 0
  const client: JevClient = { async ask(state, questions) {
    calls.push({ state, questions })
    if (calls.length === options.reject) throw new Error("transport failed after prior paid stage")
    const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      if (question.type !== "choice") throw new Error("expected choice")
      expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(255)
      let choice = name === "modelAdequacy" ? options.adequacy ?? "adequate" : name === "jobClass" ? options.jobClass ?? "research" : name === "role" ? options.role ?? "research" : name === "lane" ? options.role === "planner" ? "department" : "direct" : `${options.role ?? "research"}|PRIVATE_PROVIDER/${options.target ?? "PRIVATE_MODEL"}`
      if (name === "group") choice = Object.entries(question.criteria).find(([, value]) => value.includes(`"id":"${options.target}"`))?.[0] ?? ""
      if (name === "modelAdequacy") adequacyCalls++
      if (name === "candidate" && !options.target && !Object.hasOwn(question.criteria, choice)) choice = Object.keys(question.criteria)[0]!
      if (name === options.invalid) choice = "not-offered"
      return [name, { type: "choice", choice, confidence: name === options.low || name === "modelAdequacy" && (options.weakAdequacy || options.weakFirstAdequacy && adequacyCalls === 1) ? 0.1 : name === "role" ? 0.9 : 0.98, probabilities: name === "modelAdequacy" && options.contradictoryAdequacy ? { adequate: 0, unknown: 1 } : { [choice]: options.total ?? 1 } }]
    })) as JevCallResult["answers"]
    return { answers, model: "jev", usage: { inputTokens: 100, outputTokens: 5 }, costUsd: 0, latencyMs: 1 }
  } }
  return { client, calls }
}
const options: JobClassSelectionOptions = { definitions, readClassMembership: () => [tag("research"), tag("coding")] }

describe("job class before runtime role and model", () => {
  test("class and role requests exclude all candidate identities/facts and model stage intersects both", async () => {
    const { client, calls } = fixture()
    const rows = [candidate("PRIVATE_MODEL", "research"), candidate("PRIVATE_MODEL", "worker"), candidate("OTHER_MODEL", "research")]
    const answer = await selectJobClassModel(client, request(rows), { ...options, readClassMembership: (model) => [tag(model.id === "OTHER_MODEL" ? "coding" : "research")] })
    expect(answer.jobClass).toBe("research")
    expect(answer.role).toBe("research")
    expect(answer.model.id).toBe("PRIVATE_MODEL")
    expect(answer.confidence).toBe(0.9)
    expect(answer.classificationProvenance).toBe("jev-recommendation")
    expect(answer.usage).toBeUndefined()
    expect(calls).toHaveLength(3)
    for (const call of calls.slice(0, 2)) {
      const payload = JSON.stringify(call)
      for (const secret of ["PRIVATE_MODEL", "OTHER_MODEL", "PRIVATE_PROVIDER", "PRIVATE_FACTS", "PRIVATE_ROOT", "PRIVATE_INSTRUCTIONS"]) expect(payload.includes(secret)).toBe(false)
    }
    expect(JSON.parse(calls[0]!.state).classes.map((row: { id: string }) => row.id)).toEqual(["coding", "research"])
    expect(Object.keys(calls[2]!.questions.candidate!.type === "choice" ? calls[2]!.questions.candidate!.criteria : {})).toEqual(["research|PRIVATE_PROVIDER/PRIVATE_MODEL"])
  })

  test("task class stays independent of available model classes", async () => {
    const { client, calls } = fixture({ jobClass: "research" })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "worker")]), {
      ...options, readClassMembership: () => [tag("coding"), tag("research", 1, "unsuitable")],
    })).rejects.toMatchObject({ reason: "class_unavailable" })
    expect(calls).toHaveLength(1)
    const question = calls[0]!.questions.jobClass!
    if (question.type !== "choice") throw new Error("expected class choice")
    expect(Object.keys(question.criteria)).toEqual(["coding", "research"])
    expect(JSON.stringify(calls[0])).not.toContain("eligibleModelCount")
  })

  test("single multi-class model still receives independent class and planner selections without worker fallback", async () => {
    const { client, calls } = fixture({ jobClass: "coding", role: "planner" })
    const answer = await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "planner")]), options)
    expect(answer.role).toBe("planner")
    expect(answer.lane).toBe("department")
    expect(answer.jobClass).toBe("coding")
    expect(calls).toHaveLength(3)
  })

  test("given a worker role, runtime derives direct execution without a dependent Jev question", async () => {
    const { client, calls } = fixture({ role: "worker", jobClass: "coding", invalid: "lane" })
    const answer = await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "worker")]), options)
    expect(answer.lane).toBe("direct")
    expect(answer.laneConfidence).toBe(0.9)
    expect(Object.keys(calls[1]!.questions)).toEqual(["role"])
    expect(calls).toHaveLength(3)
  })

  test("missing, unknown and weak memberships remain explicit pending without any paid request", async () => {
    for (const memberships of [undefined, [tag("research", 1, "unknown")], [tag("research", 0.2)]]) {
      const { client, calls } = fixture()
      try {
        await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), { ...options, readClassMembership: () => memberships })
        throw new Error("expected pending")
      } catch (error) {
        expect(error instanceof JobClassSelectionError && error.reason).toBe("classification_pending")
      }
      expect(calls).toHaveLength(0)
    }
  })

  test("preserves every class/role member above the choice limit", async () => {
    const { client, calls } = fixture({ target: "model-255" })
    const answer = await selectJobClassModel(client, request(Array.from({ length: 256 }, (_, index) => candidate(`model-${index}`, "research"))), options)
    expect(answer.model.id).toBe("model-255")
    const question = calls[2]!.questions.group!
    if (question.type !== "choice") throw new Error("expected group")
    const delivered = Object.values(question.criteria).flatMap((value) => JSON.parse(value) as { model: { id: string } }[])
    expect(new Set(delivered.map((entry) => entry.model.id)).size).toBe(256)
    expect(calls).toHaveLength(4)
  })

  test("accepts the 0.99 probability rounding boundary", async () => {
    const { client } = fixture({ total: 0.99 })
    const answer = await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)
    expect(answer.probabilities).toEqual({ "research|PRIVATE_PROVIDER/PRIVATE_MODEL": 0.99 })
  })

  for (const stage of ["jobClass", "role", "candidate"]) test(`invalid ${stage} stops with earlier semantic evidence`, async () => {
    const { client, calls } = fixture({ invalid: stage })
    try {
      await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(JobClassSelectionError)
      if (!(error instanceof JobClassSelectionError)) throw error
      expect(error.reason).toBe("selection_failed")
      expect(error.stages).toHaveLength(stage === "jobClass" ? 1 : stage === "candidate" ? 3 : 2)
      expect(error.stages[0]!.result).toBeDefined()
      expect(calls).toHaveLength(error.stages.length)
    }
  })

  test("transport failure retains prior result and failing request without fabricating usage", async () => {
    const { client } = fixture({ reject: 2 })
    try {
      await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)
      throw new Error("expected failure")
    } catch (error) {
      if (!(error instanceof JobClassSelectionError)) throw error
      expect(error.stages).toHaveLength(2)
      expect(error.stages[0]!.result?.usage.inputTokens).toBe(100)
      expect(error.stages[1]!.error).toContain("transport failed")
      expect(error.cause).toBeInstanceOf(Error)
    }
  })

  test("low class confidence stops before any role/model request", async () => {
    const { client, calls } = fixture({ low: "jobClass" })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toMatchObject({ reason: "low_confidence" })
    expect(calls).toHaveLength(1)
  })

  test("rejects malformed probability distributions instead of choosing a default", async () => {
    const { client } = fixture({ total: 0.98 })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toThrow("malformed Jev jobClass response")
  })
  test("known unsuitable memberships and unavailable candidates send no request", async () => {
    const { client, calls } = fixture()
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), {
      ...options, readClassMembership: () => [tag("research", 1, "unsuitable"), tag("coding", 1, "unsuitable")],
    })).rejects.toMatchObject({ reason: "class_unavailable", stages: [] })
    const row = candidate("PRIVATE_MODEL", "research")
    await expect(selectJobClassModel(client, request([{ ...row, facts: { ...row.facts, available: false } }]), options)).rejects.toMatchObject({ reason: "class_unavailable" })
    expect(calls).toHaveLength(0)
  })

  test("reads cached membership once per model and excludes weak rows from an otherwise eligible class", async () => {
    const { client, calls } = fixture()
    const lookups: string[] = []
    await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research"), candidate("PRIVATE_MODEL", "worker"), candidate("WEAK_MODEL", "research")]), {
      ...options, readClassMembership: (model) => { lookups.push(model.id); return [tag("research", model.id === "WEAK_MODEL" ? 0.1 : 1)] },
    })
    expect(lookups).toEqual(["PRIVATE_MODEL", "WEAK_MODEL"])
    expect(JSON.stringify(calls[2])).not.toContain("WEAK_MODEL")
  })

  test("invalid group selection preserves class, role and group evidence", async () => {
    const { client, calls } = fixture({ invalid: "group", target: "model-255" })
    try {
      await selectJobClassModel(client, request(Array.from({ length: 256 }, (_, index) => candidate(`model-${index}`, "research"))), options)
      throw new Error("expected group rejection")
    } catch (error) {
      if (!(error instanceof JobClassSelectionError)) throw error
      expect(error.stages).toHaveLength(3)
      expect(error.stages.every((stage) => stage.result !== undefined)).toBe(true)
      expect(calls).toHaveLength(3)
    }
  })

  test("low preference confidence requires a separate high-confidence task adequacy decision", async () => {
    const { client, calls } = fixture({ low: "candidate" })
    const answer = await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)
    expect(calls).toHaveLength(4)
    expect(Object.keys(calls[3]!.questions)).toEqual(["modelAdequacy"])
    expect(answer.confidence).toBe(0.9)
    expect(answer.probabilities).toEqual({ "research|PRIVATE_PROVIDER/PRIVATE_MODEL": 1 })
    expect(JSON.parse(calls[3]!.state).selectedCandidate.model.id).toBe("PRIVATE_MODEL")
  })

  test("a task-unconfirmed preference tries the next eligible model within the bounded decision", async () => {
    const { client, calls } = fixture({ low: "candidate", weakFirstAdequacy: true })
    const answer = await selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research"), candidate("SECOND_MODEL", "research")]), options)
    expect(answer.model.id).toBe("SECOND_MODEL")
    expect(calls).toHaveLength(6)
    expect(JSON.stringify(calls[4]!.questions)).not.toContain("PRIVATE_MODEL")
  })

  test("high confidence cannot override contradictory task adequacy probabilities", async () => {
    const { client } = fixture({ low: "candidate", contradictoryAdequacy: true })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toMatchObject({ reason: "selection_failed" })
  })

  test("weak or malformed adequacy cannot rescue an uncertain model preference", async () => {
    for (const settings of [{ weakAdequacy: true }, { invalid: "modelAdequacy" }]) {
      const { client } = fixture({ low: "candidate", ...settings })
      await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toBeInstanceOf(JobClassSelectionError)
    }
  })

  for (const adequacy of ["unknown", "inadequate"]) test(`unconfirmed task adequacy ${adequacy} still requires caller selection`, async () => {
    const { client } = fixture({ low: "candidate", adequacy })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toMatchObject({ reason: "low_confidence" })
  })

  test("low role confidence stops before model selection", async () => {
    const { client, calls } = fixture({ low: "role" })
    await expect(selectJobClassModel(client, request([candidate("PRIVATE_MODEL", "research")]), options)).rejects.toMatchObject({ reason: "low_confidence" })
    expect(calls).toHaveLength(2)
  })

  test("intersects native caller role rules even when supplied allowed roles are broader", async () => {
    const { client, calls } = fixture()
    const input = request([candidate("PRIVATE_MODEL", "planner")])
    await expect(selectJobClassModel(client, { ...input, input: { ...input.input, parentRole: "worker" } }, options)).rejects.toMatchObject({ reason: "class_unavailable" })
    expect(calls).toHaveLength(0)
  })

})
