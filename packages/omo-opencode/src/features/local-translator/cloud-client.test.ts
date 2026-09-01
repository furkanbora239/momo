import { describe, expect, it } from "bun:test"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"
import { chatWithCloud } from "./cloud-client"

const originalFetch = globalThis.fetch

function stubFetchOnce(payload: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch
}

const cloudConfig: TranslationConfig = {
  ...DEFAULT_TRANSLATION_CONFIG,
  mode: "cloud",
  timeoutMs: 2000,
}

describe("cloud-client", () => {
  const originalApiKey = process.env["GOOGLE_API_KEY"]

  function useTestApiKey(): void {
    process.env["GOOGLE_API_KEY"] = "test-key"
  }

  function restoreApiKey(): void {
    if (originalApiKey === undefined) delete process.env["GOOGLE_API_KEY"]
    else process.env["GOOGLE_API_KEY"] = originalApiKey
  }

  it("#given a gemini response with thought and final parts #when chatWithCloud runs #then only the non-thought text is returned", async () => {
    useTestApiKey()
    stubFetchOnce({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "internal reasoning" },
              { text: "COMPRESSED_EN" },
            ],
          },
          finishReason: "STOP",
        },
      ],
    })
    try {
      const result = await chatWithCloud(cloudConfig, "system", "girdi")
      expect(result).toBe("COMPRESSED_EN")
    } finally {
      globalThis.fetch = originalFetch
      restoreApiKey()
    }
  })

  it("#given a response with only thought parts #when chatWithCloud runs #then it throws instead of returning reasoning text", async () => {
    useTestApiKey()
    stubFetchOnce({
      candidates: [
        {
          content: { parts: [{ thought: true, text: "only reasoning" }] },
          finishReason: "MAX_TOKENS",
        },
      ],
    })
    try {
      let message = ""
      try {
        await chatWithCloud(cloudConfig, "system", "girdi")
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain("no text")
      expect(message).toContain("MAX_TOKENS")
    } finally {
      globalThis.fetch = originalFetch
      restoreApiKey()
    }
  })

  it("#given no api key anywhere #when chatWithCloud runs #then it throws cloud_api_key_missing without a network call", async () => {
    delete process.env["GOOGLE_API_KEY"]
    delete process.env["GEMINI_API_KEY"]
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    try {
      let message = ""
      try {
        await chatWithCloud(cloudConfig, "system", "girdi")
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toBe("cloud_api_key_missing")
      expect(fetchCalled).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      restoreApiKey()
    }
  })

  it("#given an api error payload #when chatWithCloud runs #then the error message surfaces", async () => {
    useTestApiKey()
    stubFetchOnce({ error: { message: "quota exceeded" } })
    try {
      let message = ""
      try {
        await chatWithCloud(cloudConfig, "system", "girdi")
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toContain("quota exceeded")
    } finally {
      globalThis.fetch = originalFetch
      restoreApiKey()
    }
  })
})
