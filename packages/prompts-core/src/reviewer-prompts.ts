import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/reviewer/default.md"

export const reviewerPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/reviewer/default.md",
  },
} satisfies VariantTable
