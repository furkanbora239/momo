# src/features/local-translator/ — Prompt Translator

**Generated:** 2026-08-28 / updated 2026-09-01

## OVERVIEW

Built-in feature that intercepts every user message via
`experimental.chat.messages.transform`, translates it to English + compresses
(caveman-style: drop articles/filler, keep technical terms/code/paths exact),
then hands the compressed English message to the main model. Default on.

Two backends (`mode`):
- **cloud (default):** free Google Gemma (`gemma-4-31b-it`) via the native Gemini
  API (`:generateContent`). API key from `GOOGLE_API_KEY` / `GEMINI_API_KEY` env
  or OpenCode's `auth.json` `google` entry. Reasoning (`thought: true`) parts are
  dropped; only the final text part is used. No key → graceful pass-through.
- **local:** Ollama on this machine (`qwen2.5:1.5b` default). Detection covers
  both `~/.omo/ollama/bin/ollama` and a system Ollama on PATH
  (`bunWhich("ollama")`).

NO SUDO. The old silent `curl | sh` official-installer path is removed — it
spawned interactive sudo prompts over the user's TUI. `auto_install` (default
**false**) now only downloads the official Linux tarball into `~/.omo/ollama`
(user-local, no root). macOS/Windows: manual install instruction, no install.

Logs all I/O to `~/.omo/local-translator-logs/<date>.jsonl` for finetuning
(model label reflects the backend: `google/gemma-4-31b-it` or the Ollama tag).

## FILES

| File | Purpose |
|------|---------|
| `types.ts` | TranslationConfig, TranslationConfigInput, TranslationResult, LogEntry, defaults |
| `ollama-client.ts` | HTTP client for Ollama API (health, list models, chat) |
| `cloud-client.ts` | Gemini API client (key resolution, generateContent, thought-part filtering) |
| `ollama-installer.ts` | System+local Ollama detection, no-sudo user-local install, daemon start |
| `model-puller.ts` | Auto-pull model with SSE progress bar |
| `translation-logger.ts` | JSONL I/O logging for finetuning data collection |
| `translator.ts` | Mode routing, system prompt, skip rules, fallback |
| `hook.ts` | `experimental.chat.messages.transform` hook creator (per-mode readiness) |
| `index.ts` | Barrel exports |

## CONFIG

```jsonc
{
  "local_translator": {
    "enabled": true,             // default: true
    "mode": "cloud",             // default: cloud | "local" uses Ollama
    "cloud": {
      "provider": "google",      // only google supported
      "model": "gemma-4-31b-it", // free-tier Gemma
      "max_output_tokens": 1024  // thoughts included in the budget
    },
    "model": "qwen2.5:1.5b",     // local mode only
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": false,       // no-sudo user-local install, Linux only
    "min_length": 20,
    "log_translations": true,
    "num_ctx": 2048,
    "num_predict": 128
  }
}
```

## SKIP RULES

Messages are NOT translated when:
- Length < min_length (default 20 chars)
- Pure code block (starts/ends with ```)
- Only a file path or URL (no spaces)
- Cloud key missing / API error / Ollama unavailable (graceful fallback:
  pass through original)
