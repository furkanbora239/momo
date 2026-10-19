import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModelCardContribution, exportModelCardContributionFile, validateModelCardContributionFile } from "./model-card-export"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), "momo-card-export-"))
  roots.push(root)
  return join(root, "contribution.json")
}
const entry = {
  providerID: "private-account",
  id: "provider-model-name",
  summary: "A source-backed coding model.",
  strengths: ["code editing"],
  limitations: ["limited context"],
  sources: ["https://model.example/card"],
  researchedAt: "2026-10-19T12:00:00.000Z",
  price: { currency: "USD" as const, inputPerMillion: 0, outputPerMillion: 0, source: "https://model.example/card" },
}

describe("shared model research export", () => {
  test("exports only reusable fields with explicit canonical identity and aliases", () => {
    const document = createModelCardContribution(entry, "model-v1", ["alias-v1", "alias-v1"])
    expect(document).toEqual({ version: 1, models: [{
      canonical: "model-v1", aliases: ["alias-v1"], summary: entry.summary,
      strengths: entry.strengths, limitations: entry.limitations,
      sources: entry.sources, researchedAt: entry.researchedAt,
    }] })
    expect(JSON.stringify(document)).not.toContain("private-account")
    expect(JSON.stringify(document)).not.toContain("price")
  })

  test("rejects incomplete research and non-web citations", () => {
    expect(() => createModelCardContribution({ ...entry, summary: undefined }, "model-v1")).toThrow()
    expect(() => createModelCardContribution({ ...entry, sources: ["file:///private/account.json"] }, "model-v1")).toThrow()
    expect(() => createModelCardContribution(entry, "")).toThrow()
  })

  test("validates contribution documents and refuses overwrite without force", () => {
    const path = outputPath()
    const document = createModelCardContribution(entry, "model-v1")
    exportModelCardContributionFile(path, document)
    expect(validateModelCardContributionFile(path)).toEqual(document)
    expect(() => exportModelCardContributionFile(path, document)).toThrow()
    expect(validateModelCardContributionFile(path)).toEqual(document)
    exportModelCardContributionFile(path, document, true)
    expect(readFileSync(path, "utf8")).toEndWith("\n")
  })

  test("rejects extra provider or account fields in contribution input", () => {
    const path = outputPath()
    const document = createModelCardContribution(entry, "model-v1")
    writeFileSync(path, JSON.stringify({ ...document, providerID: "private-account" }))
    expect(() => validateModelCardContributionFile(path)).toThrow()
  })

  test("refuses citations containing credentials instead of exporting them", () => {
    for (const source of ["https://user:secret@model.example/card", "https://model.example/card?api_key=secret", "https://model.example/card?access_token=secret"]) {
      expect(() => createModelCardContribution({ ...entry, sources: [source] }, "model-v1")).toThrow()
    }
  })
})
