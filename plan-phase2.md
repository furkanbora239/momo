# plan-phase2.md — Phase 7 Implementation Guide

> Step-by-step, self-contained implementation guide for Phase 7 of the momo fork.
> A subagent receiving this file should be able to complete both features without
> asking questions. Read [`plan.md`](./plan.md) and [`AGENTS.md`](./AGENTS.md) first
> for project context and conventions.

## What we are building

Two features that serve momo's north star (minimal tokens, cheap orchestration):

1. **7A — Ponytail/Caveman prompt rewrite:** Condense the shared prompt builder
   sections and the momo/default orchestrator prompts to be terse (caveman style)
   and YAGNI-driven (ponytail ladder). This reduces input tokens on every turn
   because the system prompt is re-sent each turn.

2. **7B — Local prompt translator:** A built-in feature that intercepts every user
   message via `experimental.chat.messages.transform`, sends it to a local Ollama
   model (default Qwen 2.5 1.5B), which translates to English + compresses
   (caveman-style), then passes the compressed English message to the main model.
   Logs all I/O to JSONL for future finetuning.

## Conventions (from AGENTS.md — follow strictly)

- **Bun only** for root workspace. Typecheck with `bun run typecheck` (tsgo).
- **No lint script**; gate is `bun run typecheck` + `bun test`.
- kebab-case files/dirs; `index.ts` barrel exports; **no catch-all files**
  (`utils.ts`/`helpers.ts`/`service.ts` banned); ~200 LOC soft cap.
- Factory pattern `createXXX()` for tools/hooks/agents.
- Relative imports within a module; barrel imports across modules; **no `@/` aliases**.
- Tests: `bun:test`, given/when/then style; **never Arrange-Act-Assert comments**.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, no empty `catch {}`, no emojis, no
  em-dashes or AI filler ("simply", "obviously").
- **Never assert authored prompt wording** in tests — test routing/parsing/behavior.
- All new files under `packages/omo-opencode/src/`.

## Verification commands

```bash
bun run typecheck                    # tsgo across all packages (MUST pass)
bun test packages/omo-opencode/src   # focused test suite (MUST pass)
bun run build:schema                 # regenerate JSON schema (run after config changes)
```

---

# Feature 7A — Ponytail/Caveman Prompt Rewrite

## Goal

Condense shared prompt sections (caveman: terse prose, drop articles/filler) and
add the Ponytail YAGNI ladder (need to exist? -> already in codebase? -> stdlib?
-> native? -> dependency? -> one line? -> minimum that works). Scope: shared
sections + momo/default only. All model variants import from shared builders, so
this propagates everywhere.

## Key constraint (from Ponytail philosophy)

**Lazy about the solution, never about reading.** Trace the real flow first, then
climb the ladder. Never cut: validation at trust boundaries, error handling that
prevents data loss, security, accessibility. Compression removes prose bloat and
redundant examples — not safety rules.

## Step 7A.1 — Add Ponytail ladder section to core sections

**File:** `packages/omo-opencode/src/agents/dynamic-agent-core-sections.ts`

Add a new exported function `buildPonytailLadderSection()` at the end of the file
(before the last export if any, or just add it). Content:

```typescript
export function buildPonytailLadderSection(): string {
  return `<ponytail_ladder>
## Solution Ladder (stop at first rung that holds)

1. Need to exist? -> skip, say so in one line (YAGNI)
2. Already in this codebase? -> reuse, don't rewrite
3. Stdlib does it? -> use it
4. Native platform feature covers it? -> use it
5. Already-installed dependency? -> use it
6. One line? -> one line
7. Only then: minimum code that works

Lazy about solution, never about reading. Trace the flow first, then climb.
Two rungs work -> take the higher one, move on.
Bug fix = root cause, not symptom. Grep every caller, fix the shared function once.

Never cut: input validation at trust boundaries, error handling preventing data loss,
security, accessibility. Anything explicitly requested.
Shortest working diff wins, but only once you understand the problem.
No unrequested abstractions. No new dependency if avoidable. Deletion over addition.
</ponytail_ladder>`
}
```

Also export it from the barrel in `dynamic-agent-prompt-builder.ts`:

**File:** `packages/omo-opencode/src/agents/dynamic-agent-prompt-builder.ts`

Add `buildPonytailLadderSection` to the import from `./dynamic-agent-core-sections`
and to the export list (same pattern as the other `build*Section` exports).

## Step 7A.2 — Condense core sections (caveman style)

**File:** `packages/omo-opencode/src/agents/dynamic-agent-core-sections.ts`

Condense each function. Keep the same function signatures and return types. Keep
all technical content (agent names, tool names, trigger conditions). Remove prose
bloat, redundant examples, verbose explanations. Here are the target rewrites:

### `buildOracleSection` — condense from ~30 lines to ~12

Replace the verbose Oracle section with:

```typescript
export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((agent) => agent.name === "oracle")
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle = read-only expensive consultant (architecture/debugging only)

Consult when:
${useWhen.map((entry) => `- ${entry}`).join("\n")}

Skip when:
${avoidWhen.map((entry) => `- ${entry}`).join("\n")}

Announce "Consulting Oracle: [reason]" before calling (ONLY exception to no-narration rule).
Wait for result before final answer. Never poll. Never cancel.
Oracle-dependent work BLOCKED until result arrives. Do non-overlapping prep while waiting.
</Oracle_Usage>`
}
```

### `buildParallelDelegationSection` — condense from ~25 lines to ~10

```typescript
export function buildParallelDelegationSection(
  model: string,
  categories: AvailableCategory[],
): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  const hasDelegationCategory = categories.some(
    (category) => category.name === "deep" || category.name === "unspecified-high",
  )
  if (!isNonClaude || !hasDelegationCategory) return ""

  return `### Decompose and Delegate
Failure mode: implementing yourself instead of delegating. Subagents have domain configs,
loaded skills, tuned prompts. Always decompose into independent units. Delegate each to
deep/unspecified-high agent in parallel (run_in_background=true). Never sequential when
parallel is possible. Never implement directly when delegation fits.
Vague delegation = failed work. Each prompt needs: GOAL + success criteria + file paths +
constraints + patterns to follow + scope boundary.`
}
```

### `buildExploreSection` — condense

```typescript
export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((agent) => agent.name === "explore")
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore = Contextual Grep (peer tool, not fallback)
Use direct tools when:
${avoidWhen.map((entry) => `- ${entry}`).join("\n")}
Fire explore when:
${useWhen.map((entry) => `- ${entry}`).join("\n")}
Delegation trust: once you fire explore for a search, don't manually redo it.`
}
```

### `buildLibrarianSection` — condense

```typescript
export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((agent) => agent.name === "librarian")
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian = Reference Grep (external: docs, OSS, web)
Internal grep = explore. External grep = librarian. Fire proactively for unfamiliar libraries.
Triggers:
${useWhen.map((entry) => `- "${entry}"`).join("\n")}`
}
```

### `buildNonClaudePlannerSection` — condense

```typescript
export function buildNonClaudePlannerSection(model: string): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  if (!isNonClaude) return ""

  return `### Plan Agent (Non-Claude)
Multi-step task -> consult plan agent FIRST. Never start implementation without a plan.
Single-file/trivial -> proceed directly. Otherwise: task(subagent_type="plan") first.
Use task_id to resume same plan agent. If anything ambiguous, ask plan agent before guessing.`
}
```

### `buildToolSelectionTable`, `buildKeyTriggersSection`, `buildDelegationTable`, `buildFrontendGuidanceSection`

These are already fairly compact (data-driven from agent metadata). Leave as-is
unless obvious prose bloat exists. Do not change function signatures.

## Step 7A.3 — Condense policy sections

**File:** `packages/omo-opencode/src/agents/dynamic-agent-policy-sections.ts`

### `buildAntiDuplicationSection` — condense from ~45 lines to ~15

```typescript
export function buildAntiDuplicationSection(): string {
  return `<Anti_Duplication>
## Anti-Duplication (CRITICAL)
After delegating to explore/librarian, do NOT redo that search yourself.
Allowed: non-overlapping work, unrelated files, independent prep.
When waiting for delegated results: end response, wait for notification, then collect
via background_output(task_id="bg_..."). Do NOT re-search while waiting.
Duplicate exploration wastes tokens and risks contradicting agent findings.
</Anti_Duplication>`
}
```

### `buildToolCallFormatSection` — condense

```typescript
export function buildToolCallFormatSection(): string {
  return `## Tool Call Format
Use native tool calling. Never output tool calls as text. Never write JSON in your response.
The system handles formatting automatically.`
}
```

### `buildHardBlocksSection`, `buildAntiPatternsSection` — leave as-is

These are already compact bullet lists. Do not change.

## Step 7A.4 — Integrate ponytail ladder into momo-orchestrator

**File:** `packages/omo-opencode/src/agents/sisyphus/momo-orchestrator.ts`

1. Add `buildPonytailLadderSection` to the imports from `../dynamic-agent-prompt-builder`.
2. Call it: `const ponytailLadder = buildPonytailLadderSection();`
3. Insert `${ponytailLadder}` into the prompt string, right after the `<momo_core_behavior>`
   block and before `<self_knowledge>`.
4. Condense the verbose blocks in `<momo_core_behavior>`:
   - The "HARD DELEGATION MANDATE" section: keep the 5-step list, remove verbose
     explanations. The "only work you do directly" list is fine (short).
   - The "CATALOG-FIRST MODEL CHOICE" section: keep the workflow steps, condense
     the example from 5 lines to 2.
   - The "MINIMAL OUTPUT STYLE" section: keep the rules, condense the BAD/GOOD
     example from 4 lines to 2.
   - The "PLAN-MODE VARIANT" section: condense the plan-mode workflow from ~20
     lines to ~10. Keep the output example but shorten it.
   - The `<self_knowledge>` block: condense from ~12 lines to ~6.
   - The `<autonomy_and_persistence>`, `<investigate_before_acting>`,
     `<pragmatism_and_scope>`, `<verification>`, `<executing_actions_with_care>`
     blocks: these are already fairly terse (borrowed from the system prompt style).
     Condense each by ~30% (remove redundant sentences, keep the rules).
   - The `<behavior_instructions>` Phase 0/1/2/3 sections: condense, keep the
     workflow structure.

5. The final `<Constraints>` / `<tone_preference>` block: keep, it's already short.

**Important:** Do not remove any behavioral rule. Condense prose, not rules. If a
rule says "NEVER skip catalog_pick", keep that rule. If it says "You are an
orchestrator, not an implementer. Your job is to: 1. Understand... 2. Plan...",
condense to "Orchestrator, not implementer. 1. Understand request 2. Plan 3.
Delegate 4. Verify 5. Report".

## Step 7A.5 — Align default.ts

**File:** `packages/omo-opencode/src/agents/sisyphus/default.ts`

The `buildDefaultSisyphusPrompt` function (542 LOC) is the legacy Claude/default
variant. Condense it using the same philosophy:

1. The `<Role>` block: condense "Why Sisyphus" explanation, keep identity.
2. The `buildTaskManagementSection` function: condense both branches (task/todo).
   The "When to Create" / "Workflow" / "Why This Is Non-Negotiable" /
   "Anti-Patterns" / "Clarification Protocol" blocks can each lose ~50% prose.
   Keep all rules and the clarification protocol template (it's functional, not prose).
3. Phase 0/1/2A/2B/2C/3 sections: condense each by ~40%. Keep all rules, tables,
   and the delegation prompt structure (6 sections: TASK/EXPECTED/REQUIRED/MUST DO/
   MUST NOT DO/CONTEXT). Keep the TypeScript code examples but shorten comments.
4. `<Tone_and_Style>`: already mostly rules, condense slightly.
5. `<Constraints>`: uses shared builders, already compact.

**Do not touch the exported function signature.** `buildDefaultSisyphusPrompt` and
`buildTaskManagementSection` must keep the same parameters and return types.

## Step 7A.6 — Tests for 7A

**No new prompt-wording tests** (convention: never assert authored prompt wording).

Check if existing tests reference these functions. Search:

```bash
# Check for existing tests
```

Use Grep to find `buildOracleSection|buildAntiDuplicationSection|buildPonytailLadderSection`
in test files. If tests exist that assert on specific string content within these
sections, **update them to assert on structural properties instead** (e.g., function
returns non-empty string, contains "Oracle", contains "ponytail_ladder" XML tag name).

If no tests exist for these functions, add a minimal test file:

**File:** `packages/omo-opencode/src/agents/dynamic-agent-core-sections.test.ts`

```typescript
import { describe, expect, it } from "bun:test"
import {
  buildPonytailLadderSection,
  buildOracleSection,
  buildExploreSection,
} from "./dynamic-agent-core-sections"

describe("dynamic-agent-core-sections", () => {
  given("ponytail ladder section builder", () => {
    when("called", () => {
      const result = buildPonytailLadderSection()
      then("returns non-empty string", () => {
        expect(result.length).toBeGreaterThan(0)
      })
      then("contains ponytail_ladder tag", () => {
        expect(result).toContain("ponytail_ladder")
      })
      then("contains ladder rungs", () => {
        expect(result).toContain("YAGNI")
        expect(result).toContain("stdlib")
      })
    })
  })

  given("oracle section builder with no oracle agent", () => {
    when("called with empty agents array", () => {
      const result = buildOracleSection([])
      then("returns empty string", () => {
        expect(result).toBe("")
      })
    })
  })
})
```

Follow the same pattern for `dynamic-agent-policy-sections.test.ts` if needed.

## Step 7A.7 — Verify 7A

```bash
bun run typecheck
bun test packages/omo-opencode/src/agents
```

Both MUST pass. If typecheck fails, fix the type errors (likely missing exports
or changed signatures). If tests fail, check if they assert on specific prompt
wording that was condensed — update them to structural assertions.

---

# Feature 7B — Local Prompt Translator

## Goal

Intercept every user message, send it to a local Ollama model (Qwen 2.5 1.5B by
default), which translates to English + compresses (caveman-style), then pass the
compressed English message to the main model. Log all I/O to JSONL for future
finetuning. Auto-install Ollama + auto-pull model if missing.

## Architecture

```
User message (Turkish or English or any language)
    |
    v
experimental.chat.messages.transform hook
    |
    v
local-translator hook -> Ollama HTTP API (localhost:11434/api/chat)
    |
    v
Qwen 2.5 1.5B: translate->English + caveman-style compress
    |
    v
Compressed English message -> main model (Claude/GPT/GLM/etc.)
```

## Step 7B.1 — Config schema

**File:** `packages/omo-opencode/src/config/schema/local-translator.ts` (NEW)

```typescript
import { z } from "zod"

export const LocalTranslatorConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe("Enable local prompt translator. Default: true."),
    model: z
      .string()
      .optional()
      .describe("Ollama model tag for translation. Default: qwen2.5:1.5b."),
    ollama_host: z
      .string()
      .optional()
      .describe("Ollama API host. Default: http://localhost:11434."),
    timeout_ms: z
      .number()
      .optional()
      .describe("Translation timeout in milliseconds. Default: 30000."),
    auto_install: z
      .boolean()
      .optional()
      .describe("Auto-install Ollama if missing. Default: true."),
    min_length: z
      .number()
      .optional()
      .describe("Skip translation for messages shorter than this (chars). Default: 20."),
    log_translations: z
      .boolean()
      .optional()
      .describe("Log translation I/O to ~/.omo/local-translator-logs/ for finetuning. Default: true."),
    num_ctx: z
      .number()
      .optional()
      .describe("Ollama context window for translation model. Default: 2048."),
    num_predict: z
      .number()
      .optional()
      .describe("Max output tokens for translation. Default: 128."),
  })
  .optional()

export type LocalTranslatorConfig = z.infer<typeof LocalTranslatorConfigSchema>
```

## Step 7B.2 — Register config in root schema

**File:** `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts`

1. Add import: `import { LocalTranslatorConfigSchema } from "./local-translator"`
2. Add field to `OhMyOpenCodeConfigSchema`: 
   ```typescript
   /** Local prompt translator: translates+compresses user messages via local Ollama model. */
   local_translator: LocalTranslatorConfigSchema,
   ```
   Place it after the `catalog` field (line ~104).

## Step 7B.3 — Types

**File:** `packages/omo-opencode/src/features/local-translator/types.ts` (NEW)

```typescript
export interface TranslationConfig {
  readonly enabled: boolean
  readonly model: string
  readonly ollamaHost: string
  readonly timeoutMs: number
  readonly autoInstall: boolean
  readonly minLength: number
  readonly logTranslations: boolean
  readonly numCtx: number
  readonly numPredict: number
}

export interface TranslationResult {
  readonly originalText: string
  readonly translatedText: string
  readonly model: string
  readonly latencyMs: number
  readonly skipped: boolean
  readonly skipReason?: string
}

export interface LogEntry {
  readonly timestamp: string
  readonly originalText: string
  readonly translatedText: string
  readonly model: string
  readonly latencyMs: number
  readonly skipped: boolean
  readonly skipReason?: string
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: true,
  model: "qwen2.5:1.5b",
  ollamaHost: "http://localhost:11434",
  timeoutMs: 30000,
  autoInstall: true,
  minLength: 20,
  logTranslations: true,
  numCtx: 2048,
  numPredict: 128,
}
```

## Step 7B.4 — Ollama HTTP client

**File:** `packages/omo-opencode/src/features/local-translator/ollama-client.ts` (NEW)

```typescript
import type { TranslationConfig } from "./types"

interface OllamaChatRequest {
  model: string
  messages: { role: string; content: string }[]
  stream: false
  options: {
    temperature: number
    num_ctx: number
    num_predict: number
  }
}

interface OllamaChatResponse {
  message: { role: string; content: string }
  done: boolean
}

export async function checkOllamaHealth(host: string): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function listOllamaModels(host: string): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return []
    const data = (await response.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((model) => model.name)
  } catch {
    return []
  }
}

export async function chatWithOllama(
  config: TranslationConfig,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const request: OllamaChatRequest = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: config.numCtx,
      num_predict: config.numPredict,
    },
  }

  const response = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as OllamaChatResponse
  return data.message.content.trim()
}
```

## Step 7B.5 — Ollama installer

**File:** `packages/omo-opencode/src/features/local-translator/ollama-installer.ts` (NEW)

```typescript
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { log } from "../../shared/logger"

function getOllamaInstallDir(): string {
  return join(homedir(), ".omo", "ollama")
}

function getOllamaBinPath(): string {
  const installDir = getOllamaInstallDir()
  return process.platform === "win32"
    ? join(installDir, "ollama.exe")
    : join(installDir, "bin", "ollama")
}

export function isOllamaInstalled(): boolean {
  return existsSync(getOllamaBinPath())
}

export async function installOllama(): Promise<boolean> {
  const installDir = getOllamaInstallDir()
  mkdirSync(installDir, { recursive: true })

  log("[local-translator] Installing Ollama...")

  if (process.platform === "win32") {
    log("[local-translator] Windows: please install Ollama from https://ollama.com/download")
    return false
  }

  // Linux + macOS: official install script
  const proc = Bun.spawn(["sh", "-c", "curl -fsSL https://ollama.com/install.sh | sh"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    log("[local-translator] Ollama install failed", { exitCode, stderr })
    return false
  }

  log("[local-translator] Ollama installed successfully")
  return true
}

export async function ensureOllamaRunning(host: string): Promise<boolean> {
  const { checkOllamaHealth } = await import("./ollama-client")
  if (await checkOllamaHealth(host)) return true

  log("[local-translator] Starting Ollama daemon...")
  // Start ollama serve in background
  const proc = Bun.spawn(["ollama", "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  // Don't await — let it run in background

  // Wait for health check (up to 30 seconds)
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000)
    if (await checkOllamaHealth(host)) {
      log("[local-translator] Ollama daemon ready")
      return true
    }
  }

  log("[local-translator] Ollama daemon did not start within 30s")
  return false
}
```

## Step 7B.6 — Model puller with progress

**File:** `packages/omo-opencode/src/features/local-translator/model-puller.ts` (NEW)

```typescript
import { log } from "../../shared/logger"

interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`
}

function renderProgressBar(completed: number, total: number): string {
  if (!total || total === 0) return ""
  const percent = Math.round((completed / total) * 100)
  const filled = Math.floor(percent / 5)
  const bar = "#".repeat(filled) + ".".repeat(20 - filled)
  return `[${bar}] ${percent}% (${formatBytes(completed)}/${formatBytes(total)})`
}

export async function pullModel(
  host: string,
  model: string,
): Promise<boolean> {
  log(`[local-translator] Pulling ${model}...`)

  const response = await fetch(`${host}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(600000), // 10 min timeout for large downloads
  })

  if (!response.ok || !response.body) {
    log(`[local-translator] Pull failed: ${response.status}`)
    return false
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const progress = JSON.parse(line) as PullProgress
        if (progress.status === "downloading" && progress.total) {
          const bar = renderProgressBar(
            progress.completed ?? 0,
            progress.total,
          )
          if (bar) {
            process.stdout.write(`\r[momo] Pulling ${model} ${bar}`)
          }
        } else if (progress.status === "success") {
          process.stdout.write("\n")
          log(`[local-translator] ${model} pulled successfully`)
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return true
}

export async function ensureModelPulled(
  host: string,
  model: string,
): Promise<boolean> {
  const { listOllamaModels } = await import("./ollama-client")
  const models = await listOllamaModels(host)
  if (models.includes(model)) {
    log(`[local-translator] Model ${model} already available`)
    return true
  }

  return pullModel(host, model)
}
```

## Step 7B.7 — Translation logger (JSONL for finetuning)

**File:** `packages/omo-opencode/src/features/local-translator/translation-logger.ts` (NEW)

```typescript
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { LogEntry } from "./types"
import { log } from "../../shared/logger"

function getLogDir(): string {
  return join(homedir(), ".omo", "local-translator-logs")
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(getLogDir(), `${date}.jsonl`)
}

export function logTranslation(entry: LogEntry): void {
  try {
    mkdirSync(getLogDir(), { recursive: true })
    appendFileSync(getLogFilePath(), JSON.stringify(entry) + "\n", "utf-8")
  } catch (error) {
    log("[local-translator] Failed to write translation log", { error })
  }
}
```

## Step 7B.8 — Translator core logic

**File:** `packages/omo-opencode/src/features/local-translator/translator.ts` (NEW)

```typescript
import type { TranslationConfig, TranslationResult } from "./types"
import { chatWithOllama } from "./ollama-client"
import { logTranslation } from "./translation-logger"

const SYSTEM_PROMPT = `You are a prompt translator. Translate the input to English. Then compress it: drop articles, filler, pleasantries, hedging. Keep technical terms, code blocks, file paths, function names, and URLs exact. Fragments are OK. Short synonyms preferred. Output ONLY the translated and compressed text. No explanations. No preamble.`

function shouldSkip(text: string, minLength: number): { skip: boolean; reason?: string } {
  const trimmed = text.trim()
  if (trimmed.length < minLength) {
    return { skip: true, reason: "below_min_length" }
  }
  // Skip pure code blocks
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return { skip: true, reason: "pure_code_block" }
  }
  // Skip if it's only a file path or URL
  if (/^(\/|\.\/|\.\.\/|https?:\/\/|~\/)/.test(trimmed) && !trimmed.includes(" ")) {
    return { skip: true, reason: "path_or_url_only" }
  }
  return { skip: false }
}

export async function translateMessage(
  config: TranslationConfig,
  text: string,
): Promise<TranslationResult> {
  const startTime = Date.now()
  const skipCheck = shouldSkip(text, config.minLength)

  if (skipCheck.skip) {
    const result: TranslationResult = {
      originalText: text,
      translatedText: text,
      model: config.model,
      latencyMs: 0,
      skipped: true,
      skipReason: skipCheck.reason,
    }
    if (config.logTranslations) {
      logTranslation({
        timestamp: new Date().toISOString(),
        ...result,
      })
    }
    return result
  }

  try {
    const translated = await chatWithOllama(config, SYSTEM_PROMPT, text)
    const latencyMs = Date.now() - startTime

    const result: TranslationResult = {
      originalText: text,
      translatedText: translated,
      model: config.model,
      latencyMs,
      skipped: false,
    }

    if (config.logTranslations) {
      logTranslation({
        timestamp: new Date().toISOString(),
        ...result,
      })
    }

    return result
  } catch (error) {
    // Graceful fallback: return original text
    const latencyMs = Date.now() - startTime
    const result: TranslationResult = {
      originalText: text,
      translatedText: text,
      model: config.model,
      latencyMs,
      skipped: true,
      skipReason: `error: ${error instanceof Error ? error.message : String(error)}`,
    }

    if (config.logTranslations) {
      logTranslation({
        timestamp: new Date().toISOString(),
        ...result,
      })
    }

    return result
  }
}
```

## Step 7B.9 — Hook creator

**File:** `packages/omo-opencode/src/features/local-translator/hook.ts` (NEW)

```typescript
import type { Message, Part } from "@opencode-ai/sdk"
import { isRealUserMessage, isRealUserTextPart, log } from "../../shared"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"
import { translateMessage } from "./translator"
import { ensureOllamaRunning, isOllamaInstalled, installOllama } from "./ollama-installer"
import { ensureModelPulled } from "./model-puller"
import { checkOllamaHealth } from "./ollama-client"

function resolveConfig(rawConfig: Partial<TranslationConfig> | undefined): TranslationConfig {
  return { ...DEFAULT_TRANSLATION_CONFIG, ...rawConfig }
}

interface MessageWithParts {
  info: Message
  parts: Part[]
}

let initializationPromise: Promise<boolean> | null = null

async function ensureOllamaReady(config: TranslationConfig): Promise<boolean> {
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    // Check if Ollama is already running
    if (await checkOllamaHealth(config.ollamaHost)) {
      // Ensure model is pulled
      await ensureModelPulled(config.ollamaHost, config.model)
      return true
    }

    // Check if installed
    if (!isOllamaInstalled()) {
      if (!config.autoInstall) {
        log("[local-translator] Ollama not installed and auto_install is false")
        return false
      }
      const installed = await installOllama()
      if (!installed) return false
    }

    // Start daemon
    const running = await ensureOllamaRunning(config.ollamaHost)
    if (!running) return false

    // Pull model
    await ensureModelPulled(config.ollamaHost, config.model)
    return true
  })()

  return initializationPromise
}

export function createLocalTranslatorHook(
  rawConfig: Partial<TranslationConfig> | undefined,
) {
  const config = resolveConfig(rawConfig)

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      if (!config.enabled) return

      const { messages } = output
      if (messages.length === 0) return

      // Find last user message
      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }
      if (lastUserMessageIndex === -1) return

      const lastUserMessage = messages[lastUserMessageIndex]
      if (!lastUserMessage || !isRealUserMessage(lastUserMessage)) return

      // Find text part
      const textPartIndex = lastUserMessage.parts.findIndex(
        (part) => isRealUserTextPart(part) && "text" in part && typeof part.text === "string" && part.text.length > 0,
      )
      if (textPartIndex === -1) return

      const textPart = lastUserMessage.parts[textPartIndex]
      const originalText = (textPart as { text: string }).text
      if (!originalText) return

      // Ensure Ollama is ready (installs + pulls model on first run)
      const ready = await ensureOllamaReady(config)
      if (!ready) {
        log("[local-translator] Ollama not ready, passing through original text")
        return
      }

      // Translate
      const result = await translateMessage(config, originalText)

      if (result.skipped) {
        log("[local-translator] Skipped translation", { reason: result.skipReason })
        return
      }

      // Replace text in-place
      ;(lastUserMessage.parts[textPartIndex] as { text: string }).text = result.translatedText

      log("[local-translator] Translated user message", {
        latencyMs: result.latencyMs,
        originalLength: originalText.length,
        translatedLength: result.translatedText.length,
      })
    },
  }
}
```

## Step 7B.10 — Barrel exports

**File:** `packages/omo-opencode/src/features/local-translator/index.ts` (NEW)

```typescript
export { createLocalTranslatorHook } from "./hook"
export { checkOllamaHealth, listOllamaModels, chatWithOllama } from "./ollama-client"
export { isOllamaInstalled, installOllama, ensureOllamaRunning } from "./ollama-installer"
export { pullModel, ensureModelPulled } from "./model-puller"
export { translateMessage } from "./translator"
export { logTranslation } from "./translation-logger"
export { DEFAULT_TRANSLATION_CONFIG } from "./types"
export type { TranslationConfig, TranslationResult, LogEntry } from "./types"
```

## Step 7B.11 — Wire into transform hooks

**File:** `packages/omo-opencode/src/plugin/hooks/create-transform-hooks.ts`

1. Add import at top:
   ```typescript
   import { createLocalTranslatorHook } from "../../features/local-translator"
   ```
2. Add to `TransformHooks` type:
   ```typescript
   localTranslator: ReturnType<typeof createLocalTranslatorHook> | null
   ```
3. In `createTransformHooks()`, after the `repoMapInjector` block and before the
   `return` statement, add:
   ```typescript
   const localTranslatorConfig = pluginConfig.local_translator
   const localTranslatorEnabled = localTranslatorConfig?.enabled !== false
   const localTranslator = localTranslatorEnabled
     ? safeCreateHook(
         "local-translator",
         () =>
           createLocalTranslatorHook({
             enabled: localTranslatorConfig?.enabled !== false,
             model: localTranslatorConfig?.model,
             ollamaHost: localTranslatorConfig?.ollama_host,
             timeoutMs: localTranslatorConfig?.timeout_ms,
             autoInstall: localTranslatorConfig?.auto_install,
             minLength: localTranslatorConfig?.min_length,
             logTranslations: localTranslatorConfig?.log_translations,
             numCtx: localTranslatorConfig?.num_ctx,
             numPredict: localTranslatorConfig?.num_predict,
           }),
         { enabled: safeHookEnabled },
       )
     : null
   ```
4. Add `localTranslator` to the return object.

## Step 7B.12 — Wire into messages-transform

**File:** `packages/omo-opencode/src/plugin/messages-transform.ts`

1. Add to `MessagesTransformHooks` type:
   ```typescript
   localTranslator?: CreatedHooks["localTranslator"]
   ```
2. Add to `MESSAGES_TRANSFORM_HOOKS` array — insert as the **first** entry (before
   `btwSideContextInjector`) so translation happens before any other context injection:
   ```typescript
   { key: "localTranslator", name: "localTranslator" },
   ```
   Note: do NOT mark it `fatal: true` — translation failures must not break the chat.
   The `runMessagesTransformHookSafely` wrapper handles this.

## Step 7B.13 — AGENTS.md for the new feature module

**File:** `packages/omo-opencode/src/features/local-translator/AGENTS.md` (NEW)

```markdown
# src/features/local-translator/ — Local Prompt Translator

**Generated:** 2026-08-28

## OVERVIEW

Built-in feature that intercepts every user message via
`experimental.chat.messages.transform`, sends it to a local Ollama model
(default Qwen 2.5 1.5B), which translates to English + compresses
(caveman-style: drop articles/filler, keep technical terms/code/paths exact).
The compressed English message then goes to the main model. Default on.

Auto-installs Ollama (OS detect + install script) and auto-pulls the model
(with progress bar) on first run. Logs all I/O to
`~/.omo/local-translator-logs/<date>.jsonl` for future finetuning.

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | TranslationConfig, TranslationResult, LogEntry, defaults |
| `ollama-client.ts` | HTTP client for Ollama API (health, list models, chat) |
| `ollama-installer.ts` | OS detect + auto-install Ollama + start daemon |
| `model-puller.ts` | Auto-pull model with SSE progress bar |
| `translation-logger.ts` | JSONL I/O logging for finetuning data collection |
| `translator.ts` | Translation logic: system prompt, skip rules, cache, fallback |
| `hook.ts` | `experimental.chat.messages.transform` hook creator |
| `index.ts` | Barrel exports |

## CONFIG

```jsonc
{
  "local_translator": {
    "enabled": true,             // default: true
    "model": "qwen2.5:1.5b",     // default: qwen2.5:1.5b (alternatives: gemma3:1b, qwen2.5:0.5b)
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": true,
    "min_length": 20,
    "log_translations": true,
    "num_ctx": 2048,
    "num_predict": 128
  }
}
```

## MODEL SELECTION (from CPU benchmark research)

| Role | Model | Tag | Disk | Est. tok/s (CPU) |
|------|-------|-----|------|-----------------|
| Default (safe) | Qwen 2.5 1.5B | qwen2.5:1.5b | 986 MB | ~6-8 |
| Speed (validate) | Gemma 3 1B | gemma3:1b | 815 MB | ~13-14 |
| Bare speed (no code) | Qwen 2.5 0.5B | qwen2.5:0.5b | 398 MB | ~18-21 |

## SKIP RULES

Messages are NOT translated when:
- Length < min_length (default 20 chars)
- Pure code block (starts/ends with ```)
- Only a file path or URL (no spaces)
- Ollama unavailable (graceful fallback: pass through original)
```

## Step 7B.14 — Tests for 7B

**File:** `packages/omo-opencode/src/features/local-translator/translator.test.ts` (NEW)

```typescript
import { describe, expect, it, mock } from "bun:test"
import { translateMessage } from "./translator"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"

const config: TranslationConfig = {
  ...DEFAULT_TRANSLATION_CONFIG,
  logTranslations: false,
}

describe("translator", () => {
  given("a very short message", () => {
    when("translateMessage is called", async () => {
      const result = await translateMessage(config, "ok")
      then("skips translation", () => {
        expect(result.skipped).toBe(true)
        expect(result.skipReason).toBe("below_min_length")
      })
      then("returns original text", () => {
        expect(result.translatedText).toBe("ok")
      })
    })
  })

  given("a pure code block", () => {
    when("translateMessage is called", async () => {
      const result = await translateMessage(config, "```python\nprint('hi')\n```")
      then("skips translation", () => {
        expect(result.skipped).toBe(true)
        expect(result.skipReason).toBe("pure_code_block")
      })
    })
  })

  given("a file path only", () => {
    when("translateMessage is called", async () => {
      const result = await translateMessage(config, "/home/user/code/file.ts")
      then("skips translation", () => {
        expect(result.skipped).toBe(true)
        expect(result.skipReason).toBe("path_or_url_only")
      })
    })
  })

  given("Ollama is unreachable", () => {
    when("translateMessage is called with bad host", async () => {
      const badConfig = { ...config, ollamaHost: "http://localhost:99999" }
      const result = await translateMessage(badConfig, "Bu bir test mesajidir ve cevirilmeli")
      then("graceful fallback to original text", () => {
        expect(result.skipped).toBe(true)
        expect(result.translatedText).toBe("Bu bir test mesajidir ve cevirilmeli")
      })
    })
  })
})
```

**File:** `packages/omo-opencode/src/features/local-translator/ollama-client.test.ts` (NEW)

```typescript
import { describe, expect, it } from "bun:test"
import { checkOllamaHealth, listOllamaModels } from "./ollama-client"

describe("ollama-client", () => {
  given("a non-existent host", () => {
    when("checkOllamaHealth is called", async () => {
      const result = await checkOllamaHealth("http://localhost:99999")
      then("returns false", () => {
        expect(result).toBe(false)
      })
    })
  })

  given("a non-existent host", () => {
    when("listOllamaModels is called", async () => {
      const result = await listOllamaModels("http://localhost:99999")
      then("returns empty array", () => {
        expect(result).toEqual([])
      })
    })
  })
})
```

Add similar test files for `ollama-installer.test.ts` (test OS detection, mock
spawn) and `hook.test.ts` (test message transform, synthetic message skip,
graceful fallback). Follow the given/when/then style. Mock all external calls —
**no real Ollama calls in tests**.

## Step 7B.15 — Regenerate schema

```bash
bun run build:schema
```

This regenerates `assets/oh-my-opencode.schema.json` with the new
`local_translator` config field.

## Step 7B.16 — Verify 7B

```bash
bun run typecheck
bun test packages/omo-opencode/src/features/local-translator
bun test packages/omo-opencode/src/config
```

All MUST pass.

---

# Final verification

```bash
bun run typecheck
bun test packages/omo-opencode
bun run build:schema
```

All MUST pass. If `bun run typecheck` fails, fix type errors. If tests fail, check
for prompt-wording assertions (forbidden — change to structural assertions) or
missing imports.

# QA (behavioral proof)

After typecheck + tests pass, drive the real harness to prove the changes land:

1. Use the `opencode-qa` skill (`.agents/skills/opencode-qa/`).
2. Isolated XDG sandbox — never touch the real `~/.local/share/opencode/opencode.db`.
3. For 7A: verify the ponytail ladder section and condensed sections appear in
   the system prompt (use the system-prompt-logger approach or inspect the agent
   config).
4. For 7B: verify the `local_translator` config field appears in the schema, and
   that the hook is registered (check `omo doctor` output for local-translator
   status if a doctor check was added, or inspect hook registration via SSE).
5. Record evidence under `.omo/evidence/<YYYYMMDD>-<short-slug>/`.

---

# Appendix: CPU benchmark research summary

Target machine: Intel i5-1155G7 (4 cores/8 threads, Tiger Lake, AVX2 + AVX-VNNI),
no dedicated GPU (Intel Iris Xe integrated only), CPU-only inference via Ollama
(llama.cpp backend).

## Measured benchmarks (sourced)

| Source | Hardware | Qwen2.5 0.5B | Qwen2.5 1.5B | Qwen2.5 3B |
|--------|----------|-------------|-------------|-----------|
| samarkanov.info (Feb 2026) | 8 vCores, CPU-only | 27.4 tok/s | 9.4 tok/s | 7.4 tok/s |
| blog.jiatool.com (Sep 2024) | i7-12700, 12C/20T | ~50 tok/s | -- | ~10 tok/s |

## Estimated tok/s on i5-1155G7 (extrapolated, ~60-75% of 8-vCore VPS)

| Model | Disk (Q4) | Est. tok/s | Est. latency (50-token output) |
|-------|-----------|-----------|-------------------------------|
| Qwen 2.5 0.5B | 398 MB | ~18-21 | ~3-4 s |
| Qwen 2.5 1.5B | 986 MB | ~6-8 | ~8 s |
| Gemma 3 1B | 815 MB | ~13-14 | ~4-5 s |
| Qwen 2.5 3B | 1.9 GB | ~5-6 | ~10-11 s |

## Ollama CPU optimizations (baked into plugin)

- `OLLAMA_LLM_LIBRARY=cpu_avx2` — force fastest CPU library (AVX2 + AVX-VNNI on Tiger Lake)
- `num_ctx=2048` — small context window (huge TTFT improvement on CPU)
- `num_predict=128` — cap output length (compression = short output)
- `temperature=0.1` — deterministic translation
- `keep_alive=-1` — model always resident in memory (no reload latency)
- `OLLAMA_NUM_PARALLEL=1` — single-stream for lowest per-request latency
- `OLLAMA_FLASH_ATTENTION=1` — may reduce memory/improve prompt-eval speed (test on/off)

## Sources

- samarkanov.info — Local LLM Performance Benchmarks (Feb 2026)
- blog.jiatool.com — Running Llama 3.2 and Qwen 2.5 on CPU using Ollama (Sep 2024)
- ollama.com/library/qwen2.5 — model card
- ollama.com/library/gemma3 — model card (140+ languages)
- docs.ollama.com/troubleshooting — LLM library selection
- docs.ollama.com/modelfile — num_ctx, num_predict, keep_alive parameters
