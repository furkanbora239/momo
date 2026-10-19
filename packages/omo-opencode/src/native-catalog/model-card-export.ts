import { readFileSync, writeFileSync } from "node:fs"
import type { NativeCatalogKnowledgeEntry } from "./knowledge-store"
import { ModelCatalogSchema, type ModelCatalog } from "./model-cards"

export function createModelCardContribution(
  entry: NativeCatalogKnowledgeEntry,
  canonical: string,
  aliases: readonly string[] = [],
): ModelCatalog {
  return ModelCatalogSchema.parse({
    version: 1,
    models: [{
      canonical,
      aliases: [...new Set(aliases)],
      summary: entry.summary ?? "",
      strengths: entry.strengths ?? [],
      limitations: entry.limitations ?? [],
      sources: entry.sources,
      researchedAt: entry.researchedAt,
    }],
  })
}

export function validateModelCardContributionFile(filePath: string): ModelCatalog {
  const document: unknown = JSON.parse(readFileSync(filePath, "utf8"))
  return ModelCatalogSchema.parse(document)
}

export function exportModelCardContributionFile(
  filePath: string,
  catalog: ModelCatalog,
  force = false,
): void {
  const validated = ModelCatalogSchema.parse(catalog)
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: force ? "w" : "wx",
  })
}
