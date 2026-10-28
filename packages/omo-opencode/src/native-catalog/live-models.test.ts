import { describe, expect, it } from "bun:test"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import type { NativeCatalogAdapterOptions } from "./types"
import { createNativeLiveModelCache, fetchNativeLiveModels } from "./live-models"

function fixture() {
  let secret = "first", binding = "one", time = 1000, calls = 0
  let response = () => Response.json({ data: [{ id: "model" }] })
  const provider = { id: "provider", integrationID: "integration", package: "openai-compatible", settings: { baseURL: "https://fixture.test/v1" } } as ProviderInfo
  const models = [{ id: "model", modelID: "model", providerID: "provider" }] as ModelInfo[]
  const options = {
    context: { integration: { connection: {
      active: async () => ({ type: "credential", id: binding }),
      resolve: async () => ({ type: "key", key: secret }),
    } } },
    now: () => time, onError: () => undefined,
    fetchImpl: async () => { calls++; return response() },
  } as unknown as NativeCatalogAdapterOptions
  const cache = createNativeLiveModelCache()
  const marked: unknown[] = []
  return { provider, models, cache, options, marked, calls: () => calls,
    secret: (value: string) => { secret = value }, binding: (value: string) => { binding = value },
    advance: () => { time += 30000 }, response: (value: typeof response) => { response = value },
    read: () => fetchNativeLiveModels(options, provider, models, (_id, reason) => marked.push(reason), cache),
  }
}

describe("native discovery cache", () => {
  it("invalidates cached success for endpoint, integration, connection and credential changes", async () => {
    const f = fixture()
    await f.read(); await f.read()
    expect(f.calls()).toBe(1)
    f.provider.settings = { baseURL: "https://changed.test/v1" }
    await f.read(); expect(f.calls()).toBe(2)
    f.provider.integrationID = "changed"
    await f.read(); expect(f.calls()).toBe(3)
    f.binding("two")
    await f.read(); expect(f.calls()).toBe(4)
    f.secret("second")
    await f.read(); expect(f.calls()).toBe(5)
    f.advance()
    await f.read(); expect(f.calls()).toBe(6)
  })

  for (const status of [401, 403, 429, 500]) it(`does not cache HTTP ${status} as permissive discovery`, async () => {
    const f = fixture()
    await f.read()
    f.secret("revoked")
    f.response(() => new Response(null, { status }))
    expect((await f.read()).unavailable?.statusCode).toBe(status)
    expect((await f.read()).unavailable?.statusCode).toBe(status)
    expect(f.calls()).toBe(3)
    expect(f.cache.size).toBe(0)
    expect(f.marked).toHaveLength(2)
  })

  for (const status of [404, 405]) it(`bounds repeated unsupported discovery (${status})`, async () => {
    const f = fixture()
    f.response(() => new Response(null, { status }))
    expect((await f.read()).authoritative).toBe(false)
    expect((await f.read()).unavailable).toBeUndefined()
    expect(f.calls()).toBe(1)
    f.advance(); await f.read()
    expect(f.calls()).toBe(2)
  })

  it("keeps successful empty discovery authoritative", async () => {
    const f = fixture()
    f.response(() => Response.json({ data: [] }))
    expect(await f.read()).toMatchObject({ authoritative: true })
    expect((await f.read()).models.size).toBe(0)
    expect(f.calls()).toBe(1)
  })

  it("does not cache malformed or failed transports", async () => {
    const f = fixture()
    f.response(() => Response.json({ error: "invalid" }))
    expect((await f.read()).unavailable).toBeDefined()
    f.response(() => { throw new Error("network") })
    expect((await f.read()).unavailable).toBeDefined()
    expect(f.cache.size).toBe(0)
  })

  it("caps provider entries and evicts expired entries", async () => {
    const f = fixture()
    for (let index = 0; index < 130; index++) {
      const provider = { ...f.provider, id: `p${index}` }
      await fetchNativeLiveModels(f.options, provider, [{ ...f.models[0]!, providerID: provider.id }], () => undefined, f.cache)
    }
    expect(f.cache.size).toBe(128)
    expect(f.cache.has("p0")).toBe(false)
    f.advance(); await f.read()
    expect(f.cache.size).toBe(1)
  })
})
