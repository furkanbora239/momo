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
