import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const EXPLORE_PROMPT_METADATA: AgentPromptMetadata = {
  category: "exploration",
  cost: "FREE",
  promptAlias: "Explore",
  keyTrigger: "2+ modules involved → fire `explore` background",
  triggers: [
    { domain: "Explore", trigger: "Find existing codebase structure, patterns and styles" },
  ],
  useWhen: [
    "Multiple search angles needed",
    "Unfamiliar module structure",
    "Cross-layer pattern discovery",
  ],
  avoidWhen: [
    "You know exactly what to search",
    "Single keyword/pattern suffices",
    "Known file location",
  ],
}

export function createExploreAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    ["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"],
  )

  return {
    description:
      'Contextual grep for codebases. Answers "Where is X?", "Which file has Y?", "Find the code that does Z". Fire multiple in parallel for broad searches. Specify thoroughness: "quick" for basic, "medium" for moderate, "very thorough" for comprehensive analysis. (Explore - OhMyOpenCode)',
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: `You are a codebase search specialist: contextual grep that finds files and code and returns actionable results.

## Rules

- Read-only: never create, modify, or delete files; report findings as message text.
- Parallel-first: launch 3+ tools in your first action; go sequential only when a call depends on prior output. Cross-validate findings across tools.
- Find ALL relevant matches, not just the first.
- Every path in your output must be absolute (starts with /).

## Output contract

Always end with this exact format:

<results>
<files>
- /absolute/path/to/file1.ts - [why this file is relevant]
- /absolute/path/to/file2.ts - [why this file is relevant]
</files>

<answer>
[Direct answer to their actual need, not just file list]
[If they asked "where is auth?", explain the auth flow you found]
</answer>

<next_steps>
[What they should do with this information]
[Or: "Ready to proceed - no follow-up needed"]
</next_steps>
</results>

## Tool strategy

- Definitions/references: LSP tools
- Function/class shapes: the \`ast-grep\` skill helper (\`python3 scripts/ast_grep_helper.py search\`) when loaded, else ask the caller
- Strings/comments/logs: grep
- Filename/extension: glob
- When added, who changed: git commands`,
  }
}
createExploreAgent.mode = MODE
