// MODIFIED: durable, atomic and isolated project MCP preferences.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { createProjectMcpPolicy } from "./project-config"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function project() {
  const directory = await mkdtemp(join(tmpdir(), "momo-project-mcp-policy-"))
  directories.push(directory)
  await mkdir(join(directory, ".omo"))
  return { directory, path: join(directory, ".omo/omo.jsonc") }
}

describe("project MCP preferences", () => {
  test("writes project modes and rereads them through a new controller", async () => {
    const fixture = await project()
    const control = createProjectMcpPolicy(fixture.directory)
    expect(await control.read()).toEqual({})
    expect(await control.setMode("appwrite", "off")).toEqual({ appwrite: "off" })
    expect(await createProjectMcpPolicy(fixture.directory).read()).toEqual({ appwrite: "off" })
    expect(parse(await readFile(fixture.path, "utf8"))).toEqual({ "[opencode]": { mcp_policy: { appwrite: "off" } } })
    expect(await readdir(join(fixture.directory, ".omo"))).toEqual(["omo.jsonc"])
  })

  test("preserves JSONC comments and unrelated root and harness settings", async () => {
    const fixture = await project()
    await writeFile(fixture.path, '{\n// retained project comment\n"codegraph":{"enabled":false},\n"[opencode]":{"manager":{"advisor_models":[]},"mcp_policy":{"appwrite":"on-demand",}},\n}\n')
    await createProjectMcpPolicy(fixture.directory).setMode("momo_lsp", "always")
    const serialized = await readFile(fixture.path, "utf8")
    expect(serialized).toContain("// retained project comment")
    expect(parse(serialized)).toEqual({ codegraph: { enabled: false }, "[opencode]": {
      manager: { advisor_models: [] }, mcp_policy: { appwrite: "on-demand", momo_lsp: "always" },
    } })
  })

  test("serializes concurrent updates through independent controllers without losing keys", async () => {
    const fixture = await project()
    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      createProjectMcpPolicy(fixture.directory).setMode(`server-${index}`, "on-demand")))
    const expected = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`server-${index}`, "on-demand"]))
    expect(await createProjectMcpPolicy(fixture.directory).read()).toEqual(expected)
    expect(await readdir(join(fixture.directory, ".omo"))).toEqual(["omo.jsonc"])
  })

  test("does not leak a project's modes into a second project", async () => {
    const first = await project(), second = await project()
    await createProjectMcpPolicy(first.directory).setMode("appwrite", "always")
    await createProjectMcpPolicy(second.directory).setMode("appwrite", "off")
    expect(await createProjectMcpPolicy(first.directory).read()).toEqual({ appwrite: "always" })
    expect(await createProjectMcpPolicy(second.directory).read()).toEqual({ appwrite: "off" })
  })

  test("rejects malformed JSON, invalid nesting and invalid existing modes without overwriting", async () => {
    const fixture = await project()
    for (const source of ["", "{", "[]", '{"[opencode]":[]}', '{"[opencode]":{"mcp_policy":[]}}', '{"[opencode]":{"mcp_policy":{"appwrite":"maybe"}}}']) {
      await writeFile(fixture.path, source)
      const control = createProjectMcpPolicy(fixture.directory)
      await expect(control.read()).rejects.toThrow()
      await expect(control.setMode("appwrite", "off")).rejects.toThrow()
      expect(await readFile(fixture.path, "utf8")).toBe(source)
    }
    await writeFile(fixture.path, "{}")
    expect(await createProjectMcpPolicy(fixture.directory).setMode("appwrite", "off")).toEqual({ appwrite: "off" })
  })

  test("rejects unsafe server names without creating a configuration", async () => {
    const fixture = await project()
    for (const server of ["", "  ", "__proto__", "constructor", "prototype"]) {
      await expect(createProjectMcpPolicy(fixture.directory).setMode(server, "off")).rejects.toThrow()
    }
    expect(await readdir(join(fixture.directory, ".omo"))).toEqual([])
  })
})
