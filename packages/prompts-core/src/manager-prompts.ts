import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/manager/default.md"

export const managerPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/manager/default.md",
  },
} satisfies VariantTable
