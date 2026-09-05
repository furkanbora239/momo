import {
  createSystemDirective,
  SystemDirectiveTypes,
} from "../../shared/system-directive"

export const COMPACTION_CONTEXT_PROMPT = `${createSystemDirective(SystemDirectiveTypes.COMPACTION_CONTEXT)}

When summarizing this session, keep the result compact, continuation-focused, and high-signal. Prefer terse bullets over replaying transcripts or pasting large raw outputs.

## 1. User Requests & Architectural Decisions
- Summarize the core user intent, requirements, and decisions agreed upon
- Explicitly record architectural choices, design rationale, and why alternative paths were rejected

## 2. PROJECT_STATE Alignment
- Note current milestone status and any updates needed for \`PROJECT_STATE.md\` at the repository root
- Ensure key file locations and structural knowledge are distilled so resuming agents do NOT perform blind cold-start directory scans (\`ls\`, \`find\`, \`grep\`)

## 3. Work Completed & Pruned Tool Outputs
- What has been implemented so far with exact file paths
- Summarize verification/test outcomes concisely (e.g., "all tests in tui-sidebar passed")
- NEVER dump raw command stdout, verbose test runner traces, or full file diffs; retain only the distilled outcome and error messages if relevant

## 4. Active Working Context & Blockers
- Active files currently being edited
- Function names, types, or data structures actively in progress
- Blockers, pending review comments, or next immediate steps

## 5. Explicit Constraints (Verbatim Only)
- Include ONLY active constraints explicitly stated by the user or existing AGENTS.md context
- Quote constraints verbatim when quoting a constraint
- Do NOT invent, add, or modify constraints
- Do not paste full AGENTS.md, system/developer messages, or long policy blocks; cite the source path/name and quote only decisive clauses
- If no explicit constraints exist, write "None"

## 6. Agent Verification State (Critical for Reviewers)
- **Current Agent**: What agent is running (momus, oracle, etc.)
- **Verification Progress**: Files already verified/validated
- **Pending Verifications**: Files still needing verification
- **Previous Rejections**: If reviewer agent, what was rejected and why
- **Acceptance Status**: Current state of review process

## 7. Delegated Agent Sessions
- List active/recent background agent tasks that still matter
- For each: agent name, category, status, short description, and **task_id**
- **RESUME, DON'T RESTART.** Each listed delegated task retains full context. After compaction, use \`task_id\` to continue existing delegated work instead of spawning new tasks. This saves tokens, preserves learned context, and prevents duplicate work.

This context is critical for maintaining continuity after compaction.
`
