/// <reference path="../../../../../bun-test.d.ts" />

import { afterEach, beforeEach, describe, test, expect } from "bun:test"
import { loadBuiltinCommands } from "./commands"
import { HANDOFF_TEMPLATE } from "./templates/handoff"
import type { BuiltinCommandName } from "./types"
import { _resetForTesting, registerAgentName } from "../claude-code-session-state"

beforeEach(() => {
  _resetForTesting()
})

afterEach(() => {
  _resetForTesting()
})

describe("loadBuiltinCommands", () => {
  test("should include handoff command in loaded commands", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = []

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.handoff).toBeDefined()
    expect(commands.handoff.name).toBe("handoff")
  })

  test("should exclude handoff when disabled", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = ["handoff"]

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.handoff).toBeUndefined()
  })

  test("should include handoff template content in command template", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.template).toContain(HANDOFF_TEMPLATE)
  })

  test("should include session context variables in handoff template", () => {
    //#given - no disabled commands

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(commands.handoff.template).toContain("$SESSION_ID")
    expect(commands.handoff.template).toContain("$TIMESTAMP")
    expect(commands.handoff.template).toContain("$ARGUMENTS")
  })

  test("should surface the retained builtin commands when nothing is disabled", () => {
    //#given

    //#when
    const commands = loadBuiltinCommands()

    //#then
    expect(Object.keys(commands)).toEqual([
      "goal",
      "stop-continuation",
      "handoff",
      "advisor",
      "momo",
      "caveman",
      "cavemen",
      "c",
    ])
  })
})

describe("loadBuiltinCommands - caveman and aliases", () => {
  test("should include caveman, cavemen, and c in loaded commands", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = []

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.caveman).toBeDefined()
    expect(commands.caveman.name).toBe("caveman")
    expect(commands.caveman.template).toContain("<caveman-prompt>")
    expect(commands.caveman.template).toContain("$ARGUMENTS")

    expect(commands.cavemen).toBeDefined()
    expect(commands.cavemen.name).toBe("cavemen")
    expect(commands.cavemen.template).toContain("<caveman-prompt>")

    expect(commands.c).toBeDefined()
    expect(commands.c.name).toBe("c")
    expect(commands.c.template).toContain("<caveman-prompt>")
  })

  test("should exclude caveman and aliases when disabled", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = ["caveman", "cavemen", "c"]

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.caveman).toBeUndefined()
    expect(commands.cavemen).toBeUndefined()
    expect(commands.c).toBeUndefined()
  })
})

describe("loadBuiltinCommands - momo", () => {
  test("should include momo command in loaded commands", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = []

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.momo).toBeDefined()
    expect(commands.momo.name).toBe("momo")
    expect(commands.momo.description).toContain("momo")
  })

  test("should exclude momo when disabled", () => {
    //#given
    const disabledCommands: BuiltinCommandName[] = ["momo"]

    //#when
    const commands = loadBuiltinCommands(disabledCommands)

    //#then
    expect(commands.momo).toBeUndefined()
  })
})
