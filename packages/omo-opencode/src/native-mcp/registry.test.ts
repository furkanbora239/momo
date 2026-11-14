import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile, symlink, lstat, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { parse } from "jsonc-parser"
import { adoptNativeMcpServers, readNativeMcpRegistry, nativeMcpRegistryPath } from "./registry"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "momo-mcp-registry-")); roots.push(root)
  return { source: join(root, "opencode.jsonc"), registry: join(root, "registry.json") }
}
test("adopts native servers before startup while preserving native definitions, comments and unrelated configuration", async () => {
  const { source, registry } = await fixture()
  await writeFile(source, '{\n// keep\n"plugins":["momo"],"mcp":{"servers":{"appwrite":{"type":"local","command":["node","fixture.js"],"environment":{"PRIVATE_KEY":"private"}},"locked":{"type":"remote","url":"https://example.invalid/mcp","disabled":true}}}}')
  const moved = await adoptNativeMcpServers({ configPath: source, registryPath: registry })
  expect(moved.servers).toEqual(["appwrite", "locked"])
  const config = parse(await readFile(source, "utf8"))
  expect(config.plugins).toEqual(["momo"])
  expect(config.mcp.servers.appwrite.disabled).toBe(true)
  expect(config.mcp.servers.appwrite.environment).toEqual({ PRIVATE_KEY: "private" })
  expect(config.mcp.servers.locked.disabled).toBe(true)
  expect(await readFile(source, "utf8")).toContain("// keep")
  const stored = await readNativeMcpRegistry(registry)
  expect(stored.appwrite?.disabled).toBe(false)
  expect(await readFile(registry, "utf8")).not.toContain("PRIVATE_KEY")
  expect(await readFile(registry, "utf8")).not.toContain('"private"')
  expect(stored.locked?.disabled).toBe(true)
  expect(await readFile(moved.backupPath, "utf8")).toContain('"PRIVATE_KEY":"private"')
  if (process.platform !== "win32") {
    expect((await stat(registry)).mode & 0o777).toBe(0o600)
    expect((await stat(moved.backupPath)).mode & 0o777).toBe(0o600)
  }
  expect((await adoptNativeMcpServers({ configPath: source, registryPath: registry })).servers).toEqual([])
})
test("does not overwrite malformed configuration or replace an existing connector silently", async () => {
  const { source, registry } = await fixture()
  await writeFile(source, "{")
  await expect(adoptNativeMcpServers({ configPath: source, registryPath: registry })).rejects.toThrow()
  expect(await readFile(source, "utf8")).toBe("{")
  await writeFile(source, JSON.stringify({ mcp: { servers: { a: { type: "local", command: ["one"] } } } }))
  await adoptNativeMcpServers({ configPath: source, registryPath: registry })
  const changed = JSON.stringify({ mcp: { servers: { a: { type: "local", command: ["two"] } } } })
  await writeFile(source, changed)
  await expect(adoptNativeMcpServers({ configPath: source, registryPath: registry })).rejects.toThrow()
  expect(await readFile(source, "utf8")).toBe(changed)
})

test("preserves a linked configuration and keeps its private backup beside the registry", async () => {
  if (process.platform === "win32") return
  const fixture = await fixtureForSymlink()
  await writeFile(fixture.target, JSON.stringify({ mcp: { servers: { one: { type: "local", command: ["one"] } }, futureOption: true } }))
  await symlink(fixture.target, fixture.source)
  const adopted = await adoptNativeMcpServers({ configPath: fixture.source, registryPath: fixture.registry })
  expect((await lstat(fixture.source)).isSymbolicLink()).toBe(true)
  expect(dirname(adopted.backupPath)).toBe(dirname(fixture.registry))
  expect(parse(await readFile(fixture.target, "utf8"))).toEqual({ mcp: { servers: { one: { type: "local", command: ["one"], disabled: true } }, futureOption: true } })
  await mkdir(fixture.actualDir)
  await symlink(fixture.actualDir, fixture.linkDir)
  expect(nativeMcpRegistryPath(fixture.home, fixture.linkDir)).toBe(nativeMcpRegistryPath(fixture.home, fixture.actualDir))
})
async function fixtureForSymlink() {
  const root = await mkdtemp(join(tmpdir(), "momo-mcp-symlink-")); roots.push(root)
  return { home: root, source: join(root, "opencode.jsonc"), target: join(root, "target.jsonc"), registry: join(root, "private/registry.json"), actualDir: join(root, "real"), linkDir: join(root, "link") }
}
