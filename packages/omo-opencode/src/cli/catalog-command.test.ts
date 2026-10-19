import { afterEach, describe, expect, test } from "bun:test"
import { Command } from "commander"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configureCatalogCommand } from "./catalog-command"
import { createNativeCatalogKnowledgeStore } from "../native-catalog/knowledge-store"
import { validateModelCardContributionFile } from "../native-catalog/model-card-export"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), "momo-catalog-command-"))
  roots.push(root)
  const messages: string[] = []
  const program = new Command().exitOverride()
  configureCatalogCommand(program, { homeDirectory: root, write: (message) => messages.push(message) })
  return { root, program, messages }
}

describe("catalog contribution commands", () => {
  test("exports from the native local knowledge store and validates the result", async () => {
    const { root, program, messages } = setup()
    createNativeCatalogKnowledgeStore(join(root, ".omo", "native", "catalog-knowledge.json")).upsert({
      providerID: "example", id: "transport-model", summary: "A researched model.",
      sources: ["https://model.example/card"], researchedAt: "2026-10-19T00:00:00.000Z",
    })
    const output = join(root, "model-card.json")
    const args = ["catalog", "export", "--provider", "example", "--model", "transport-model", "--canonical", "model-v1", "--alias", "alias-one", "--alias", "alias-two", "--output", output]
    await program.parseAsync(args, { from: "user" })
    expect(validateModelCardContributionFile(output).models[0]).toMatchObject({ canonical: "model-v1", aliases: ["alias-one", "alias-two"] })
    await program.parseAsync(["catalog", "validate", output], { from: "user" })
    expect(messages).toHaveLength(2)
    await expect(program.parseAsync(args, { from: "user" })).rejects.toThrow()
    await program.parseAsync([...args, "--force"], { from: "user" })
  })

  test("missing local research creates no output or local store", async () => {
    const { root, program } = setup()
    const output = join(root, "missing.json")
    await expect(program.parseAsync(["catalog", "export", "--provider", "unknown", "--model", "missing", "--canonical", "model-v1", "--output", output], { from: "user" })).rejects.toThrow("No local research")
    expect(existsSync(output)).toBe(false)
    expect(existsSync(join(root, ".omo"))).toBe(false)
  })
})
