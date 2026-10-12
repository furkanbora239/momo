import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeControlStores, NativeControlStoreError } from "./native-control-stores"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "momo-native-controls-"))
  roots.push(root)
  return root
}

describe("native routing control stores", () => {
  test("missing and valid empty files preserve allow-all and default-enabled semantics", async () => {
    const stores = createNativeControlStores(await home())
    expect(stores.readPool().allowed).toEqual([])
    expect(stores.readProviderToggles().disabled).toEqual([])
    stores.writePool({ version: 1, allowed: [], updatedAt: "" })
    stores.writeProviderToggles({ version: 1, disabled: [], updatedAt: "" })
    expect(stores.readPool().allowed).toEqual([])
    expect(stores.readProviderToggles().disabled).toEqual([])
  })

  test("malformed and unreadable existing stores fail explicitly", async () => {
    const root = await home()
    const stores = createNativeControlStores(root)
    const directory = join(root, ".omo")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "model-pool.json"), "{broken", "utf8")
    expect(() => stores.readPool()).toThrow(NativeControlStoreError)
    await rm(join(directory, "model-pool.json"))
    await mkdir(join(directory, "provider-toggles.json"))
    expect(() => stores.readProviderToggles()).toThrow(NativeControlStoreError)
  })

  test("writes control state atomically with private file permissions", async () => {
    const root = await home()
    const stores = createNativeControlStores(root)
    stores.writePool({ version: 1, allowed: [{ providerID: "p", modelID: "m" }], updatedAt: "now" })
    stores.writeProviderToggles({ version: 1, disabled: ["p"], updatedAt: "now" })
    const directory = join(root, ".omo")
    expect((await stat(join(directory, "model-pool.json"))).mode & 0o777).toBe(0o600)
    expect((await stat(join(directory, "provider-toggles.json"))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(directory, "provider-toggles.json"), "utf8")).toContain('"p"')
  })
})
