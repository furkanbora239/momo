import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/planner/default.md"

export const plannerPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/planner/default.md",
  },
} satisfies VariantTable
