import { expect, test } from "bun:test"
import { nativeRoleTransition } from "./role-transition"

const switched = { type: "agent-switched", previous: "momo-orchestrator", agent: "momo-worker" }

test("reports the durable switch while generating the first turn in the new role", () => {
  const history = [{ type: "idle" }, switched, { type: "user" }, { type: "assistant", agent: "momo-worker" }]
  const transition = nativeRoleTransition("momo-worker", history)
  expect(transition).toContain(switched.previous)
  expect(transition).toContain(switched.agent)
})

test("stops injecting the transition after the first turn in the new role has finished", () => {
  expect(nativeRoleTransition("momo-worker", [switched, { type: "assistant", agent: "momo-worker" }, { type: "idle" }, { type: "user" }])).toBeUndefined()
})

test("leaves switches involving external agents to OpenCode", () => {
  expect(nativeRoleTransition("momo-worker", [{ ...switched, previous: "build" }])).toBeUndefined()
})


test("keeps a switch pending if the outgoing role finishes after selection", () => {
  const history = [switched, { type: "assistant", agent: "momo-orchestrator" }, { type: "idle" }, { type: "user" }]
  expect(nativeRoleTransition("momo-worker", history)).toContain(switched.agent)
})
