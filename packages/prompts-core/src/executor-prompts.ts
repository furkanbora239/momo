import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/executor/default.md"

export const executorPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/executor/default.md",
  },
} satisfies VariantTable
