import { describe, expect, mock, test } from "bun:test"
import { resolve } from "node:path"

import { openChat } from "./chat-command"

const directory = resolve("chat-project")

function fixture(choice?: string) {
  return {
    interactive: true,
    chooseModel: mock(async (_models: readonly string[]) => choice),
    capture: mock(async (args: readonly string[], _directory: string) => {
      if (args[0] === "models") return "fixture/alpha\nfixture/organization/beta\n"
      const { model } = JSON.parse(args.at(-1) ?? "{}")
      return JSON.stringify({ data: { id: "ses_chosen", model } })
    }),
    open: mock(async (_sessionID: string, _args: readonly string[], _directory: string) => 0),
  }
}

describe("openChat", () => {
  test("creates a chat with the chosen model and opens that same session", async () => {
    const deps = fixture("fixture/organization/beta")
    const server = "http://127.0.0.1:4097"
    const code = await openChat(directory, { server, prompt: "hello" }, deps)

    expect(code).toBe(0)
    expect(deps.chooseModel).toHaveBeenCalledWith(["fixture/alpha", "fixture/organization/beta"])
    expect(deps.capture.mock.calls).toEqual([
      [["models", "--server", server], directory],
      [["api", "session.create", "--server", server, "--data", JSON.stringify({
        location: { directory }, model: { providerID: "fixture", id: "organization/beta" },
      })], directory],
    ])
    expect(deps.open).toHaveBeenCalledWith("ses_chosen", ["--server", server, "--prompt", "hello"], directory)
  })

  test("cancelling the picker creates no session and sends no startup prompt", async () => {
    const deps = fixture()
    const code = await openChat(directory, { prompt: "hello" }, deps)

    expect(code).toBe(0)
    expect(deps.capture.mock.calls).toEqual([[["models"], directory]])
    expect(deps.open).not.toHaveBeenCalled()
  })

  test("an explicit available model bypasses the picker", async () => {
    const deps = fixture()
    await openChat(directory, { model: "fixture/alpha" }, deps)

    expect(deps.chooseModel).not.toHaveBeenCalled()
    expect(deps.open).toHaveBeenCalledWith("ses_chosen", [], directory)
  })

  test("an unavailable explicit model cannot fall back or start a chat", async () => {
    const deps = fixture()
    await expect(openChat(directory, { model: "fixture/missing" }, deps)).rejects.toThrow("Model unavailable")

    expect(deps.chooseModel).not.toHaveBeenCalled()
    expect(deps.capture).toHaveBeenCalledTimes(1)
    expect(deps.open).not.toHaveBeenCalled()
  })

  test("a session saved with a different model never opens", async () => {
    const deps = fixture("fixture/alpha")
    deps.capture.mockImplementationOnce(async () => "fixture/alpha")
    deps.capture.mockImplementationOnce(async () =>
      JSON.stringify({ data: { id: "ses_chosen", model: { providerID: "fixture", id: "wrong" } } }),
    )
    await expect(openChat(directory, {}, deps)).rejects.toThrow("did not save the selected model")

    expect(deps.open).not.toHaveBeenCalled()
  })

  test("without a terminal it performs no OpenCode operations", async () => {
    const deps = { ...fixture(), interactive: false }
    await expect(openChat(directory, {}, deps)).rejects.toThrow("requires an interactive terminal")

    expect(deps.capture).not.toHaveBeenCalled()
    expect(deps.open).not.toHaveBeenCalled()
  })
})
