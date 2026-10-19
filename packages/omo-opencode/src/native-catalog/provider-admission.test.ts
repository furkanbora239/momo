import { expect, test } from "bun:test"
import { connectedNativeProviders } from "./provider-admission"
import type { NativeCatalogContext } from "./types"

function fixture() {
  let activation = "enabled", integrationID = "first", entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), held = new Promise<void>(resolve => { release = resolve })
  const context = {
    provider: { list: async () => ({ data: [{ id: "manager", activation, integrationID }] }) },
    integration: { connection: { active: async () => { entered(); await held; return { id: "active-connection" } } } },
  } as unknown as NativeCatalogContext
  const read = () => connectedNativeProviders({ context, toggles: () => ({ version: 1, disabled: [], updatedAt: "fixture" }), health: () => ({}), now: Date.now })
  return { read, started, release: () => release(), activation: (value: string) => { activation = value }, integration: (value: string) => { integrationID = value } }
}
test("given native activation changes while integration lookup waits, a cloned earlier snapshot cannot authorize the provider", async () => {
  const f = fixture(), pending = f.read(); await f.started; f.activation("disabled"); f.release()
  const result = await pending; expect(result.providers).toEqual([]); expect(result.unavailable.manager?.reason).toBe("disabled in OpenCode provider settings")
})
test("given integration binding changes during lookup, admission cannot borrow authorization from the old connection", async () => {
  const f = fixture(), pending = f.read(); await f.started; f.integration("replacement"); f.release()
  const result = await pending; expect(result.providers).toEqual([]); expect(result.unavailable.manager?.reason).toContain("integration changed")
  expect((await f.read()).providers.map(provider => provider.id)).toEqual(["manager"])
})

test("anonymous public admission keeps provider controls and rejects custom endpoints", async () => {
  let disabled: string[] = []
  let endpoint = "https://opencode.ai/zen/v1"
  const context = { provider: { list: async () => ({ data: [{ id: "opencode", activation: "enabled", integrationID: "zen", settings: { baseURL: endpoint } }] }) },
    integration: { connection: { active: async () => undefined } } } as unknown as NativeCatalogContext
  const read = () => connectedNativeProviders({ context, toggles: () => ({ version: 1, disabled, updatedAt: "test" }), health: () => ({}), now: Date.now, publicModels: [{ providerID: "opencode", id: "free-model" }] })
  expect((await read()).publicOnlyProviders).toEqual(["opencode"])
  disabled = ["opencode"]
  expect((await read()).providers).toEqual([])
  disabled = []; endpoint = "https://example.com/v1"
  expect((await read()).providers).toEqual([])
})
