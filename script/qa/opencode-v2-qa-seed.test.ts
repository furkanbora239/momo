import { test, expect } from "bun:test"
import { withOpenCodeGoProvider, stripJsonc } from "./opencode-v2-qa-seed.ts"
import { RUNBOOK_MODEL } from "./opencode-v2-qa-types.ts"

const AUTH = JSON.stringify({ "opencode-go": { type: "api", key: "SECRET_KEY_123" } })

test("stripJsonc removes line and block comments outside strings", () => {
  const src = `{
  // a line comment
  "a": 1, /* block */ "b": "https://x/y" // trailing
}`
  const out = stripJsonc(src)
  expect(() => JSON.parse(out)).not.toThrow()
  const parsed = JSON.parse(out)
  expect(parsed.a).toBe(1)
  expect(parsed.b).toBe("https://x/y")
})

test("withOpenCodeGoProvider injects opencode-go from go-b baseURL", () => {
  const cfg = JSON.stringify({
    providers: {
      "go-b": {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "{env:OPENCODE_GO_B_KEY}" },
      },
    },
  })
  const out = withOpenCodeGoProvider(cfg, AUTH)
  const parsed = JSON.parse(out)
  const og = parsed.providers["opencode-go"]
  expect(og).toBeDefined()
  expect(og.settings.apiKey).toBe("SECRET_KEY_123")
  expect(og.settings.baseURL).toBe("https://opencode.ai/zen/go/v1")
  const [pid, mid] = RUNBOOK_MODEL.split("/")
  expect(parsed.providers[pid].models[mid]).toBeDefined()
})

test("withOpenCodeGoProvider is idempotent and refreshes the key", () => {
  const cfg = JSON.stringify({
    providers: { "opencode-go": { settings: { apiKey: "STALE", baseURL: "https://old" } } },
  })
  const out = withOpenCodeGoProvider(cfg, AUTH)
  const parsed = JSON.parse(out)
  expect(parsed.providers["opencode-go"].settings.apiKey).toBe("SECRET_KEY_123")
  expect(parsed.providers["opencode-go"].settings.baseURL).toBe("https://old")
})

test("withOpenCodeGoProvider throws when auth has no opencode-go key", () => {
  expect(() => withOpenCodeGoProvider("{}", JSON.stringify({ google: { key: "x" } }))).toThrow()
})
