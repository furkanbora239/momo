import { describe, expect, test } from "bun:test"

import {
  buildChildQuestionAnswerPrompt,
  buildChildQuestionNotificationText,
  buildUserEscalationNotificationText,
  isQuestionTool,
  parseChildQuestionEvent,
  parseQuestionArgs,
  resolveQuestionRouteTarget,
} from "./subagent-question-router"
import type { PendingQuestion } from "./subagent-question-router"

function makePending(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    childSessionId: "child-session",
    taskId: "task-1",
    parentSessionId: "parent-session",
    questions: [{ question: "Should I commit?" }],
    route: "orchestrator",
    askedAt: 0,
    answered: false,
    escalated: false,
    ...overrides,
  }
}

describe("subagent-question-router — tool detection + route resolution", () => {
  test("detects the question tool under all known names", () => {
    expect(isQuestionTool("question")).toBe(true)
    expect(isQuestionTool("Ask_User_Question")).toBe(true)
    expect(isQuestionTool("askUserQuestion")).toBe(true)
    expect(isQuestionTool("task")).toBe(false)
  })

  test("defaults to orchestrator route", () => {
    expect(resolveQuestionRouteTarget({})).toBe("orchestrator")
    expect(resolveQuestionRouteTarget({ route: "orchestrator" })).toBe("orchestrator")
  })

  test("explicit user route is honored", () => {
    expect(resolveQuestionRouteTarget({ route: "user" })).toBe("user")
  })
})

describe("subagent-question-router — arg parsing", () => {
  test("parses the questions array shape", () => {
    const questions = parseQuestionArgs({
      questions: [
        {
          question: "Pick one",
          header: "Decision",
          options: [{ label: "A", description: "first" }, { label: "B" }],
          multiSelect: false,
        },
      ],
    })
    expect(questions).toHaveLength(1)
    expect(questions[0].question).toBe("Pick one")
    expect(questions[0].header).toBe("Decision")
    expect(questions[0].options).toEqual([{ label: "A", description: "first" }, { label: "B" }])
    expect(questions[0].multiSelect).toBe(false)
  })

  test("falls back to the legacy single-question shape", () => {
    const questions = parseQuestionArgs({
      question: "Legacy?",
      header: "H",
      options: [{ label: "yes" }],
    })
    expect(questions).toHaveLength(1)
    expect(questions[0].question).toBe("Legacy?")
  })

  test("returns empty when neither shape is present", () => {
    expect(parseQuestionArgs({})).toEqual([])
  })
})

describe("subagent-question-router — notification text", () => {
  test("carries the task anchor and question text to the orchestrator", () => {
    const text = buildChildQuestionNotificationText(makePending({
      questions: [{ question: "Commit now?", options: [{ label: "yes", description: "do it" }] }],
    }))
    expect(text).toContain("task_id=task-1")
    expect(text).toContain("session_id=child-session")
    expect(text).toContain("Commit now?")
    expect(text).toContain("yes")
    expect(text).toContain("do it")
  })

  test("answer prompt embeds the orchestrator answer", () => {
    const prompt = buildChildQuestionAnswerPrompt("Use shell", makePending())
    expect(prompt).toContain("Use shell")
    expect(prompt).toContain("ORCHESTRATOR ANSWER")
    expect(prompt).toContain("Should I commit?")
  })

  test("escalation text marks user fallback", () => {
    const text = buildUserEscalationNotificationText(makePending())
    expect(text).toContain("escalated to user")
    expect(text).toContain("Should I commit?")
  })
})

describe("subagent-question-router — event parsing", () => {
  test("parses the V1 properties shape", () => {
    const parsed = parseChildQuestionEvent({
      type: "tool.execute.before",
      properties: { sessionID: "s1", tool: "question", args: { questions: [{ question: "q?" }] } },
    })
    expect(parsed).toEqual({
      sessionID: "s1",
      tool: "question",
      args: { questions: [{ question: "q?" }] },
    })
  })

  test("parses the V2 data shape with nested input/output", () => {
    const parsed = parseChildQuestionEvent({
      type: "tool.execute.before",
      data: {
        sessionID: "s2",
        input: { tool: "ask_user_question" },
        output: { args: { questions: [{ question: "q2?" }] } },
      },
    })
    expect(parsed?.sessionID).toBe("s2")
    expect(parsed?.tool).toBe("ask_user_question")
    expect(parsed?.args).toEqual({ questions: [{ question: "q2?" }] })
  })

  test("parses the live V2 session.tool.called shape (no tool name)", () => {
    const parsed = parseChildQuestionEvent({
      type: "session.tool.called",
      data: {
        sessionID: "s3",
        assistantMessageID: "m1",
        input: {
          questions: [{ header: "Codename", question: "What is the codename?" }],
          route: "orchestrator",
        },
        executed: false,
      },
    })
    expect(parsed?.sessionID).toBe("s3")
    // No `tool`/`name` field is present on session.tool.called.
    expect(parsed?.tool).toBe("")
    expect(parsed?.args).toEqual({
      questions: [{ header: "Codename", question: "What is the codename?" }],
      route: "orchestrator",
    })
  })

  test("parses the V2 session.tool.input.ended shape (JSON text args)", () => {
    const parsed = parseChildQuestionEvent({
      type: "session.tool.input.ended",
      data: {
        sessionID: "s4",
        name: "question",
        text: JSON.stringify({ questions: [{ question: "q4?" }], route: "user" }),
      },
    })
    expect(parsed?.sessionID).toBe("s4")
    expect(parsed?.tool).toBe("question")
    expect(parsed?.args).toEqual({ questions: [{ question: "q4?" }], route: "user" })
  })

  test("returns undefined for unrelated events", () => {
    expect(parseChildQuestionEvent({ type: "session.idle", properties: {} })).toBeUndefined()
    expect(parseChildQuestionEvent(null)).toBeUndefined()
  })
})
