import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionInfo } from "@opencode/client"
import { createNativeCatalogAdapter } from "../native-catalog"
import { createNativeControlStores } from "../native-catalog/native-control-stores"
import type { NativeCatalogContext } from "../native-catalog/types"
import type { NativeJevRequest } from "../native-routing/types"
import { createNativeModelAdmission } from "./model-admission"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "momo-provider-admission-")); roots.push(home)
  const providers = ["manager", "worker"].map((id) => ({ id, name: id, activation: "enabled", package: "fixture", settings: { apiKey: "local-only" } }))
  const model = { providerID: "worker", id: "model" }
  let onList: (() => Promise<void> | void) | undefined
  const context = {
    provider: { list: async () => { await onList?.(); return { data: providers } } },
    model: { list: async () => ({ data: [{ ...model, modelID: "model", name: "Model", enabled: true, status: "active", package: "fixture", settings: {}, capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [], limit: { context: 32000, output: 4096 } }] }) },
    integration: { connection: { active: async () => undefined } },
  } as unknown as NativeCatalogContext
  const controls = createNativeControlStores(home)
  const catalog = createNativeCatalogAdapter({ context, homeDirectory: home, advisorModels: [model] })
  const admission = createNativeModelAdmission({ context, homeDirectory: home, catalog, managerProviderID: "manager", reject: (message) => { throw new Error(message) } })
  const request: NativeJevRequest = {
    decisionId: "decision", input: { prompt: "work", rootSessionID: "root", parentSessionID: "root", parentRole: "orchestrator", kind: "task" },
    allowedRoles: ["worker"], candidates: [{ role: "worker", model, facts: { ...model, available: true }, knowledge: { model, known: false } }],
    knowledge: [], outcomes: [], instructions: "route",
  }
  const session = (child: boolean): SessionInfo => ({ id: child ? "child" : "root", ...(child ? { parentID: "root" } : {}), projectID: "project", agent: "momo-worker", model, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 }, location: { directory: "/fixture" } })
  return { providers, controls, catalog, admission, request, session, setOnList: (callback: () => Promise<void> | void) => { onList = callback } }
}

describe("native model admission", () => {
  it("rejects a toggled-off manager even when its configured credential remains present", async () => {
    const h = fixture()
    h.controls.writeProviderToggles({ version: 1, disabled: ["manager"], updatedAt: "test" })
    await expect(h.admission.assertManagerProvider()).rejects.toThrow("disabled by provider toggle")
  })

  it("rejects native provider deactivation independently of local toggle state", async () => {
    const h = fixture(); h.providers[0].activation = "disabled"
    await expect(h.admission.assertManagerProvider()).rejects.toThrow("disabled in OpenCode")
  })

  it("allows the manager outside the worker pool and rejects stale worker candidates", async () => {
    const h = fixture()
    h.controls.writePool({ version: 1, allowed: [{ providerID: "worker", modelID: "model" }], updatedAt: "test" })
    await h.admission.beforeRoutingRequest(h.request)
    h.controls.writeProviderToggles({ version: 1, disabled: ["worker"], updatedAt: "test" })
    await expect(h.admission.beforeRoutingRequest(h.request)).rejects.toThrow("eligibility changed")
  })

  it("rechecks child pool at execution while preserving the selected root model", async () => {
    const h = fixture()
    await h.admission.beforeModelRequest(h.session(true))
    h.controls.writePool({ version: 1, allowed: [{ providerID: "other", modelID: "other" }], updatedAt: "test" })
    await expect(h.admission.beforeModelRequest(h.session(true))).rejects.toThrow("allowed pool")
    await h.admission.beforeModelRequest(h.session(false))
  })

  it("rechecks revoked advisor binding at execution", async () => {
    const h = fixture(); const session = { ...h.session(true), agent: "momo-advisor" }
    await h.admission.beforeModelRequest(session)
    h.catalog.setAdvisorModels([])
    await expect(h.admission.beforeModelRequest(session)).rejects.toThrow("allowed pool")
  })

  it("rechecks advisor revocation during the last native manager lookup", async () => {
    const h = fixture(); let calls = 0
    h.setOnList(() => { if (++calls === 3) h.catalog.setAdvisorModels([]) })
    const candidate = { ...h.request.candidates[0], role: "advisor" as const }
    await expect(h.admission.beforeRoutingRequest({ ...h.request, candidates: [candidate] })).rejects.toThrow("eligibility changed")
  })

  it("rechecks native activation after catalog admission and before generation", async () => {
    const h = fixture(); let calls = 0
    h.setOnList(() => { if (++calls === 3) h.providers[1].activation = "disabled" })
    await expect(h.admission.beforeModelRequest(h.session(true))).rejects.toThrow("provider is no longer available")
  })

  it("keeps the visible snapshot current when shared refresh callers finish at different times", async () => {
    const h = fixture(); let calls = 0; let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })
    h.setOnList(async () => { if (++calls === 3) await blocked })
    const first = h.catalog.refresh(); const second = h.catalog.refresh()
    try {
      expect((await first).models).toHaveLength(1)
      h.controls.writeProviderToggles({ version: 1, disabled: ["worker"], updatedAt: "test" })
      release?.()
      expect((await second).models).toEqual([])
      expect(h.catalog.snapshot().models).toEqual([])
    } finally { release?.(); await second }
  })
})
