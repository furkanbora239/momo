import { describe, expect, it } from "bun:test"
import { translateMessage } from "./translator"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"

const config: TranslationConfig = {
  ...DEFAULT_TRANSLATION_CONFIG,
  logTranslations: false,
}

describe("translator", () => {
  it("skips a very short message (below_min_length)", async () => {
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
    const badConfig = { ...config, ollamaHost: "http://localhost:99999" }
    const result = await translateMessage(badConfig, "Bu bir test mesajidir ve cevirilmeli")
    expect(result.skipped).toBe(true)
    expect(result.translatedText).toBe("Bu bir test mesajidir ve cevirilmeli")
  })
})
