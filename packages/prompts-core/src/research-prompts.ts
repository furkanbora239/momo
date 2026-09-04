import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/research/default.md"

export const researchPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/research/default.md",
  },
} satisfies VariantTable
