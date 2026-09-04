import { describe, expect, it } from "bun:test"
import { translateMessage, _resetTranslationCacheForTesting } from "./translator"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"

const originalFetch = globalThis.fetch

const config: TranslationConfig = {
  ...DEFAULT_TRANSLATION_CONFIG,
  logTranslations: false,
}

describe("translator", () => {
  const originalFetch = globalThis.fetch

  it("skips a very short message (below_min_length)", async () => {
    _resetTranslationCacheForTesting()
    const result = await translateMessage(config, "ok")
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("below_min_length")
    expect(result.translatedText).toBe("ok")
  })

  it("skips a pure code block (pure_code_block)", async () => {
    const result = await translateMessage(config, "```python\nprint('hi')\n```")
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("pure_code_block")
  })

  it("skips a file path only (path_or_url_only)", async () => {
    const result = await translateMessage(config, "/home/user/code/file.ts")
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe("path_or_url_only")
  })

  it("gracefully falls back to original text when Ollama is unreachable", async () => {
    const badConfig = { ...config, mode: "local" as const, ollamaHost: "http://localhost:99999" }
    const result = await translateMessage(badConfig, "Bu bir test mesajidir ve cevirilmeli")
    expect(result.skipped).toBe(true)
    expect(result.translatedText).toBe("Bu bir test mesajidir ve cevirilmeli")
  })

  it("labels the model with provider and model id in cloud mode", async () => {
    process.env["GOOGLE_API_KEY"] = "test-key"
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ thought: true, text: "thoughts" }, { text: "COMPRESSED_EN" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const result = await translateMessage(cloudConfig, "Bu bir test mesajidir ve cevirilmeli")
      expect(result.skipped).toBe(false)
      expect(result.translatedText).toBe("COMPRESSED_EN")
      expect(result.model).toBe(`google/${DEFAULT_TRANSLATION_CONFIG.cloud.model}`)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
    }
  })

  it("falls back to the original text when the cloud call fails", async () => {
    _resetTranslationCacheForTesting()
    process.env["GOOGLE_API_KEY"] = "test-key"
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const text = "Bu bir test mesajidir ve cevirilmeli"
      const result = await translateMessage(cloudConfig, text)
      expect(result.skipped).toBe(true)
      expect(result.translatedText).toBe(text)
      expect(result.skipReason).toContain("error:")
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
      _resetTranslationCacheForTesting()
    }
  })

  it("#given a thought-only MAX_TOKENS cloud response #when translateMessage runs #then it retries once with doubled maxOutputTokens and succeeds", async () => {
    _resetTranslationCacheForTesting()
    process.env["GOOGLE_API_KEY"] = "test-key"
    const requests: { url: string; body: string }[] = []
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") })
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ thought: true, text: "only reasoning" }] },
                finishReason: "MAX_TOKENS",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "RETRY_OK" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const text = "Bu bir butce testi mesajidir ve cevirilmeli"
      const result = await translateMessage(cloudConfig, text)
      expect(result.skipped).toBe(false)
      expect(result.translatedText).toBe("RETRY_OK")
      expect(requests.length).toBe(2)
      const firstBudget = JSON.parse(requests[0]!.body).generationConfig.maxOutputTokens
      const secondBudget = JSON.parse(requests[1]!.body).generationConfig.maxOutputTokens
      expect(secondBudget).toBe(firstBudget * 2)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
      _resetTranslationCacheForTesting()
    }
  })

  it("#given a partial-text MAX_TOKENS cloud response #when translateMessage runs #then it retries once with doubled maxOutputTokens and succeeds", async () => {
    _resetTranslationCacheForTesting()
    process.env["GOOGLE_API_KEY"] = "test-key"
    const requests: { url: string; body: string }[] = []
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") })
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { thought: true, text: "thinking..." },
                    { text: "TRUNCATED_PARTIAL" },
                  ],
                },
                finishReason: "MAX_TOKENS",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "FULL_OUTPUT_ON_RETRY" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const text = "Bu uzun bir mesajdir ve butce asilmistir"
      const result = await translateMessage(cloudConfig, text)
      expect(result.skipped).toBe(false)
      expect(result.translatedText).toBe("FULL_OUTPUT_ON_RETRY")
      expect(requests.length).toBe(2)
      const firstBudget = JSON.parse(requests[0]!.body).generationConfig.maxOutputTokens
      const secondBudget = JSON.parse(requests[1]!.body).generationConfig.maxOutputTokens
      expect(secondBudget).toBe(firstBudget * 2)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
      _resetTranslationCacheForTesting()
    }
  })

  it("#given repeated thought-only MAX_TOKENS cloud responses #when translateMessage runs #then it falls through to pass-through after the single retry", async () => {
    _resetTranslationCacheForTesting()
    process.env["GOOGLE_API_KEY"] = "test-key"
    let fetchCount = 0
    globalThis.fetch = (async () => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ thought: true, text: "only reasoning" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const text = "Bu bir dusus testi mesajidir ve cevirilmeli"
      const result = await translateMessage(cloudConfig, text)
      expect(result.skipped).toBe(true)
      expect(result.translatedText).toBe(text)
      expect(result.skipReason).toContain("error:")
      expect(fetchCount).toBe(2)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
      _resetTranslationCacheForTesting()
    }
  })

  it("serves a repeat call from cache without a second network round-trip", async () => {
    _resetTranslationCacheForTesting()
    process.env["GOOGLE_API_KEY"] = "test-key"
    let fetchCount = 0
    globalThis.fetch = (async () => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ thought: true, text: "thoughts" }, { text: "COMPRESSED_EN" }] },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch
    try {
      const cloudConfig: TranslationConfig = { ...config, mode: "cloud" }
      const text = "Bu bir cache test mesajidir ve cevrilmeli"
      const first = await translateMessage(cloudConfig, text)
      const second = await translateMessage(cloudConfig, text)
      expect(first.skipped).toBe(false)
      expect(second.translatedText).toBe(first.translatedText)
      expect(second.latencyMs).toBe(0)
      expect(fetchCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
      _resetTranslationCacheForTesting()
    }
  })
})
