import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isModelAllowed } from "../shared/model-pool"
import { createRoutingAssistant } from "./routing-assistant"
import { createRoutingProfileStore, effectiveRoutingPool, type RoutingProfile } from "./routing-profile"

const legacy: RoutingProfile = {
  decision: { kind: "jev" },
  pool: { mode: "all", models: [] },
  advisors: [],
  research: { kind: "inherit" },
}
const worker = { id: "worker", providerID: "openai", type: "chat", available: true, toolCall: true }
const chat = { id: "chat", providerID: "openai", type: "chat", available: true, toolCall: false }
const other = { ...worker, providerID: "opencode-go" }

test("explicit empty pools stay closed while switching projects' saved profiles", () => {
  const root = mkdtempSync(join(tmpdir(), "momo-routing-profile-test-"))
  try {
    const path = join(root, "routing-profiles.json")
    const store = createRoutingProfileStore(path, () => legacy)
    expect(store.current()).toBeUndefined()
    const chatgpt = store.save("", "chatgpt", { ...legacy, pool: { mode: "allowlist", models: [] } })
    const go = store.save(chatgpt.revision, "go", { ...legacy, pool: { mode: "paused", models: [] } })
    expect(() => store.save(chatgpt.revision, "auto", legacy)).toThrow("Routing settings changed")
    const reopened = createRoutingProfileStore(path, () => legacy)
    const saved = reopened.read()
    expect(saved).toMatchObject({ active: "go", revision: go.revision })
    expect(isModelAllowed(effectiveRoutingPool(saved.profiles.chatgpt!), "openai", "worker")).toBe(false)
    expect(isModelAllowed(effectiveRoutingPool(saved.profiles.go!), "openai", "worker")).toBe(false)
    expect(isModelAllowed(effectiveRoutingPool(legacy), "openai", "worker")).toBe(true)
    writeFileSync(path, "invalid json")
    expect(() => reopened.current()).toThrow("Cannot read project routing profiles")
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test("AI fill enforces the selected provider and worker tool eligibility", async () => {
  const list = async () => [worker, chat, other]
  const suggest = (workers: number[]) => createRoutingAssistant(list, async () =>
    JSON.stringify({ decision: 1, workers, reasons: { decision: "Connected model", workers: "Tools available" } }), () => true)

  expect(await suggest([0]).suggest(chat, "chatgpt")).toMatchObject({
    decision: { id: "chat", providerID: "openai" },
    workers: [{ id: "worker", providerID: "openai" }],
  })
  await expect(suggest([1]).suggest(chat, "chatgpt")).rejects.toThrow("outside the eligible options")
  await expect(suggest([2]).suggest(chat, "chatgpt")).rejects.toThrow("outside the eligible options")
})

test("configuration can retain saved unavailable choices while validating new bindings", async () => {
  const assistant = createRoutingAssistant(async () => [worker, chat], async () => "", () => false)
  const profile: RoutingProfile = { ...legacy, pool: { mode: "allowlist", models: [{ id: "worker", providerID: "opencode-go" }] } }
  await expect(assistant.validate(profile, legacy)).rejects.toThrow("opencode-go/worker is unavailable")
  expect(await assistant.validate(profile, profile)).toEqual(profile)
})
