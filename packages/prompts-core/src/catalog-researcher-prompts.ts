import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/catalog-researcher/default.md"

export const catalogResearcherPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/catalog-researcher/default.md",
  },
} satisfies VariantTable
