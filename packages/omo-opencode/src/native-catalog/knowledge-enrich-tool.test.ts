import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeCatalogKnowledgeStore } from "./knowledge-store"
import { createNativeCatalogKnowledgeTool } from "./knowledge-enrich-tool"

const context = (agent: string): ToolContext => ({
  sessionID: "session-1",
  agent,
  messageID: "message-1",
  id: "call-1",
  signal: new AbortController().signal,
  progress: async () => {},
}) as unknown as ToolContext

describe("native catalog enrichment tool", () => {
  test("only catalog-researcher can save HTTP-sourced profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-enrich-"))
    const store = createNativeCatalogKnowledgeStore(join(root, "knowledge.json"))
    let activeOwned = false
    const tool = createNativeCatalogKnowledgeTool(store, (agentID) => activeOwned && agentID === "momo-catalog-researcher", () => Date.parse("2026-10-12T00:00:00.000Z"))

    expect(tool.options).toEqual({ permission: "momo_catalog_enrich", codemode: false })
    const profile = {
      providerID: "provider",
      id: "alias",
      summary: "Published model facts",
      sources: ["https://provider.example/docs/model"],
      strengths: ["small tasks"],
      price: { currency: "USD", inputPerMillion: 0, outputPerMillion: 0.2, source: "https://provider.example/docs/model" },
    }

    try {
      await expect(tool.execute(profile, context("orchestrator"))).rejects.toThrow("active momo catalog-researcher")
      await expect(tool.execute(profile, context("momo-catalog-researcher"))).rejects.toThrow("active momo catalog-researcher")
      activeOwned = true
      const saved = await tool.execute(profile, context("momo-catalog-researcher"))

      expect(saved.content).toContain("Saved sourced profile")
      expect(store.read({ providerID: "provider", id: "alias" })).toMatchObject({ known: true, source: profile.sources[0] })
      await expect(tool.execute({ ...profile, sources: ["assistant says so"] }, context("momo-catalog-researcher"))).rejects.toThrow("at least one source is required")
      await expect(tool.execute({ ...profile, price: { ...profile.price, currency: "EUR" } }, context("momo-catalog-researcher"))).rejects.toThrow("price requires finite non-negative USD")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
