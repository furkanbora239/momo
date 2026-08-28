import { describe, expect, it } from "bun:test"
import { isOllamaInstalled } from "./ollama-installer"

describe("ollama-installer", () => {
  it("returns a boolean for isOllamaInstalled", () => {
    expect(typeof isOllamaInstalled()).toBe("boolean")
  })
})
