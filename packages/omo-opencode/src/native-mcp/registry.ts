// MODIFIED: private connector ownership prevents native host startup before policy.
import { createHash, randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { z } from "zod"
import { assertMcpServerName } from "./policy"

const common = { disabled: z.boolean().optional(), codemode: z.boolean().optional(), protocol: z.enum(["legacy", "auto", "2026-07-28"]).optional(), timeout: z.object({ startup: z.number().int().optional(), catalog: z.number().int().optional(), execution: z.number().int().optional() }).optional() }
const strings = z.record(z.string(), z.string())
const serverConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local"), command: z.array(z.string()).min(1), cwd: z.string().optional(), environment: strings.optional(), ...common }).passthrough(),
  z.object({ type: z.literal("remote"), url: z.string().min(1), headers: strings.optional(), oauth: z.union([z.literal(false), z.object({ client_id: z.string().optional(), client_secret: z.string().optional(), scope: z.string().optional(), callback_port: z.number().int().optional(), redirect_uri: z.string().optional(), auth_server_metadata_url: z.string().optional() }).passthrough()]).optional(), ...common }).passthrough(),
])
const registrySchema = z.object({ version: z.literal(1), sourceConfig: z.string(), backupPath: z.string(), servers: z.record(z.string(), z.object({ disabled: z.boolean(), fingerprint: z.string() })) })
type Registry = z.infer<typeof registrySchema>

export function nativeMcpRegistryPath(home: string, configDirectory: string): string {
  let canonical = resolve(configDirectory)
  try { canonical = realpathSync(canonical) }
  catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error }
  const scope = createHash("sha256").update(canonical).digest("hex").slice(0, 24)
  return join(home, ".omo", "native", "mcp-servers", scope + ".json")
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]))
  return value
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
async function registry(path: string): Promise<Registry | undefined> {
  try { return registrySchema.parse(JSON.parse(await readFile(path, "utf8"))) }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined; throw error }
}
export async function readNativeMcpRegistry(path: string): Promise<Readonly<Registry["servers"]>> {
  const value = await registry(path)
  for (const server of Object.keys(value?.servers ?? {})) assertMcpServerName(server)
  return value?.servers ?? {}
}
async function atomicWrite(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + "." + randomUUID() + ".tmp"
  try { await writeFile(temporary, source, { flag: "wx", mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}
export async function adoptNativeMcpServers(options: { configPath: string; registryPath: string }): Promise<{ servers: string[]; backupPath: string }> {
  const configPath = await realpath(options.configPath)
  const source = await readFile(configPath, "utf8")
  const errors: ParseError[] = []
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !object(parsed)) throw new Error("Invalid native OpenCode configuration")
  if (parsed.mcp !== undefined && !object(parsed.mcp)) throw new Error("Invalid native MCP configuration")
  const mcp = object(parsed.mcp) ? parsed.mcp : undefined
  if (mcp?.servers !== undefined && !object(mcp.servers)) throw new Error("Expected native mcp.servers object")
  if (mcp && !("servers" in mcp) && Object.keys(mcp).length) throw new Error("Expected native v2 mcp.servers layout")
  const servers = z.record(z.string(), serverConfig).parse(mcp?.servers ?? {})
  for (const server of Object.keys(servers)) assertMcpServerName(server)
  const existing = await registry(options.registryPath)
  if (existing && existing.sourceConfig !== configPath) throw new Error("This connector registry belongs to another configuration")
  const nextServers = { ...existing?.servers }
  const adopted: string[] = []
  for (const [name, config] of Object.entries(servers)) {
    const { disabled, ...definition } = config
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical(definition))).digest("hex")
    const previous = existing?.servers[name]
    if (previous && previous.fingerprint !== fingerprint) throw new Error(`MCP ${name} already has a different managed definition`)
    if (previous && disabled === true) continue
    nextServers[name] = { disabled: disabled === true, fingerprint }
    adopted.push(name)
  }
  if (!adopted.length) return { servers: [], backupPath: existing?.backupPath ?? "" }
  const backupPath = join(dirname(options.registryPath), "backup-" + randomUUID() + ".jsonc")
  await mkdir(dirname(backupPath), { recursive: true })
  await writeFile(backupPath, source, { flag: "wx", mode: 0o600 })
  const next: Registry = { version: 1, sourceConfig: configPath, backupPath, servers: nextServers }
  // Keep native interpolation and credentials in their original configuration.
  // Publish ownership before masking startup; interrupted adoption can be retried.
  await atomicWrite(options.registryPath, JSON.stringify(next, null, 2) + "\n")
  let updated = source
  for (const name of adopted) updated = applyEdits(updated, modify(updated, ["mcp", "servers", name, "disabled"], true, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  await atomicWrite(configPath, updated)
  return { servers: adopted, backupPath }
}
