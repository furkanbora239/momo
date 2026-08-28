import { describe, expect, it } from "bun:test"
import { checkOllamaHealth, listOllamaModels } from "./ollama-client"

describe("ollama-client", () => {
  it("returns false for a non-existent host health check", async () => {
    expect(await checkOllamaHealth("http://localhost:99999")).toBe(false)
  })

  it("returns an empty array for a non-existent host model list", async () => {
    expect(await listOllamaModels("http://localhost:99999")).toEqual([])
  })
})
