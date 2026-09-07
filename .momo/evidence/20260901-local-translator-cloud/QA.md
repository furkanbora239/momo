# 2026-09-01 — local-translator: cloud (Google Gemma) mode + no-sudo install fix

## Why

The user opened opencode, picked a model via /models, and saw a `[sudo] password`
prompt hijack the chat screen. Root cause chain (all verified):

1. `local_translator` hook (default ON, `auto_install: true` legacy default) ran
   `curl -fsSL https://ollama.com/install.sh | sh` because `isOllamaInstalled()`
   only checked `~/.omo/ollama/bin/ollama` (empty dir) and ignored the system
   Ollama at `/usr/local/bin/ollama`.
2. The official install.sh invoked `sudo install -o0 -g0 -m755 -d /usr/local/bin`
   — sudo prompts on the controlling TTY (`/dev/pts/2`), bypassing the plugin's
   piped stdio, so the prompt rendered on top of the opencode TUI.
3. journalctl proof: `17:02:31 → 1 incorrect password attempt`, `17:03:46 →
   USER_AUTH res=success` (sudo session for the ollama install), PWD=momo dir,
   spawned by the momo plugin ("Installing Ollama..." at 14:03:39.390Z in
   `/tmp/oh-my-opencode.log`).

## Changes

- `types.ts`: `mode: "cloud" | "local"` (default **cloud**), `cloud` config
  (provider google, model gemma-4-31b-it, max_output_tokens 1024);
  `auto_install` default flipped to **false**.
- `cloud-client.ts` (new): Gemini native `:generateContent` client. Key from
  `GOOGLE_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` env or
  OpenCode `auth.json` `google` entry (read-only, never logged). `thought: true`
  parts are dropped; only final text parts are returned.
- `translator.ts`: mode routing + model label (`google/gemma-4-31b-it` or ollama
  tag) + in-memory translation cache (50 entries, key = mode+model+text) so
  repeated LLM steps do not re-translate the same user message (was 5-8s per
  step on cloud, 5.5s on local qwen).
- `ollama-installer.ts`: system Ollama detection via PATH (`bunWhich("ollama")`)
  in addition to `~/.omo/ollama/bin/ollama`; `installOllama()` no longer runs the
  official sudo-installing script — Linux-only, user-local tarball into
  `~/.omo/ollama` via `curl | tar` (no root, stdin ignored); macOS/Windows log a
  manual instruction and return false.
- `hook.ts`: per-mode readiness (cloud = key presence only; local = ollama
  pipeline without the removed installer path).
- `config/schema/local-translator.ts` + `create-transform-hooks.ts`: new
  `mode`/`cloud` keys wired; `auto_install` semantics updated.
- Schema regenerated (`bun run build:schema`), help template line updated,
  feature AGENTS.md updated, `~/.omo/omo.jsonc` gained an explicit cloud block.

## Evidence

- `translation-log-tail.jsonl` — real cloud translations logged for finetuning:
  `"butun testleri gecirip degisiklikleri commit et"` → `"Pass all tests, commit
  changes."` model `google/gemma-4-31b-it` (vs the old qwen2.5:1.5b output that
  mangled the same message into nonsense).
- `momo-log-translator.txt` — `[local-translator] Translated user message` lines;
  second call shows `latencyMs: 0` (cache hit, no re-network, no duplicate log).
- No `[local-translator] Installing Ollama...` lines after the fix; no new
  ollama processes; no sudo invocations during QA.
- Isolation: QA ran against `XDG_*` under `/tmp/opencode/lt-cloud-qa`; real DB
  session count after QA = 66 with zero new sessions (file
  `real-db-session-count.txt`).
- Tests: 23 pass in `features/local-translator` (incl. new cloud-client +
  cache + system-ollama detection tests); `bun run typecheck` green;
  `bun run build` regenerated `dist/index.js` (loaded by the user's opencode
  via `file:///.../dist/index.js`).

## Notes

- Pre-existing, environment-only: a sandboxed `opencode` boot crashed with
  `ProviderModelNotFoundError: opencode-go/glm-5.2` because the freshly fetched
  index lacks that model id (the user's real `~/.cache/opencode/models.json`
  still has it). Verified pre-existing by reproducing with the pre-change dist.
