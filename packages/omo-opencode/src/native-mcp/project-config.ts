// MODIFIED: momo project MCP preferences with serialized atomic JSONC updates.
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { assertMcpServerName, isMcpMode, type McpMode, type McpPolicy } from "./policy"

const pendingWrites = new Map<string, Promise<void>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function policyFromSource(source: string): McpPolicy {
  const errors: ParseError[] = []
  const config: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !isRecord(config)) throw new Error("Invalid project MCP JSONC configuration")
  const opencode = config["[opencode]"]
  if (opencode === undefined) return {}
  if (!isRecord(opencode)) throw new Error("Invalid project OpenCode configuration")
  const policy = opencode.mcp_policy
  if (policy === undefined) return {}
  if (!isRecord(policy)) throw new Error("Invalid project MCP policy")
  const result: Record<string, McpMode> = {}
  for (const [server, mode] of Object.entries(policy)) {
    assertMcpServerName(server)
    if (!isMcpMode(mode)) throw new Error(`Invalid MCP mode for ${server}`)
    result[server] = mode
  }
  return result
}

async function readSource(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "{}\n"
    throw error
  }
}

function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const result = (pendingWrites.get(path) ?? Promise.resolve()).then(operation)
  const settled = result.then(() => undefined, () => undefined)
  pendingWrites.set(path, settled)
  void settled.then(() => { if (pendingWrites.get(path) === settled) pendingWrites.delete(path) })
  return result
}

export function createProjectMcpPolicy(directory: string): {
  read(): Promise<McpPolicy>
  setMode(server: string, mode: McpMode): Promise<McpPolicy>
} {
  const path = join(resolve(directory), ".omo", "omo.jsonc")
  return {
    async read() {
      await pendingWrites.get(path)
      return policyFromSource(await readSource(path))
    },
    async setMode(server, mode) {
      assertMcpServerName(server)
      if (!isMcpMode(mode)) throw new Error("Invalid MCP mode")
      return serialize(path, async () => {
        const source = await readSource(path)
        policyFromSource(source)
        const updated = applyEdits(source, modify(source, ["[opencode]", "mcp_policy", server], mode, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }))
        const policy = policyFromSource(updated)
        await mkdir(dirname(path), { recursive: true })
        const temporary = `${path}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, updated, { flag: "wx", mode: 0o600 })
          await rename(temporary, path)
        } finally {
          await rm(temporary, { force: true })
        }
        return policy
      })
    },
  }
}
