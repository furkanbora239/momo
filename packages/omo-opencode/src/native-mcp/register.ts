// MODIFIED: native project policy, scoped activation and live user controls.
import type { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { createNativeSearchFallbackConfigs } from "../native-search/fallback"
import { loadNativeRuntimeConfig } from "../native-runtime/native-config"
import { homeRoot } from "../native-runtime/user-data-paths"
import { ownedAgentID } from "../native-runtime/role-policy"
import { createNativeMcpController } from "./controller"
import { createProjectMcpPolicy } from "./project-config"
import { nativeMcpConfiguration } from "./configuration"
import { readNativeMcpRegistry } from "./registry"
import { nativeMcpMode, nativeMcpToolInput } from "./schema"

export async function registerNativeMcpControl(ctx: Plugin.Context, activeOwnedIDs: ReadonlySet<string>) {
  const directory = ctx.location.directory
  const store = createProjectMcpPolicy(directory)
  let configuration = loadNativeRuntimeConfig(directory)
  const settings = () => ({ modes: configuration.mcp_policy, disabledMcps: configuration.disabled_mcps })
  const control = createNativeMcpController({ settings, persist: async (server, mode) => {
    await store.setMode(server, mode)
    configuration = loadNativeRuntimeConfig(directory)
  }, reload: () => ctx.mcp.reload() })
  let serverNames: string[] = []
  const fallback = createNativeSearchFallbackConfigs({ cwd: directory, homeDirectory: homeRoot() })
  const managed = await readNativeMcpRegistry(nativeMcpConfiguration().registryPath)
  const registration = await ctx.mcp.transform(editor => {
    configuration = loadNativeRuntimeConfig(directory)
    for (const [name, config] of Object.entries(fallback)) {
      const disabled = config.disabled === true || (managed[name] ? managed[name].disabled : editor.get(name)?.disabled === true)
      editor.set(name, { ...config, disabled })
    }
    control.observe(editor.list().map(([name, config]) => ({ name, upstreamDisabled: Object.hasOwn(fallback, name) ? config.disabled === true : managed[name] ? managed[name].disabled : config.disabled === true })))
    serverNames = editor.list().map(([name]) => name).sort((a, b) => b.length - a.length)
    for (const [name] of editor.list()) editor.update(name, config => { config.disabled = !control.shouldConnect(name) })
  })
  function serverForTool(tool: string): string | undefined {
    if (["execute", "momo_mcp", "momo_task", "momo_consult", "momo_catalog_enrich"].includes(tool)) return undefined
    return serverNames.find(server =>
      tool.startsWith(`${server}_`) || tool.startsWith(`${server}.`) || tool.startsWith(`mcp__${server}__`))
  }
  async function snapshot() {
    const actual = new Map((await ctx.mcp.list()).data.map(row => [row.name, { status: row.status.status }]))
    return { servers: control.snapshot().map(row => ({ ...row, startupManaged: Object.hasOwn(managed, row.server) || Object.hasOwn(fallback, row.server), status: actual.get(row.server) ?? { status: "pending" } })) }
  }
  const before = await ctx.tool.hook("execute.before", event => {
    const server = serverForTool(event.tool)
    if (server) control.beginCall(server, event.id)
  })
  const after = await ctx.tool.hook("execute.after", event => control.endCall(event.id))
  const context = await ctx.session.hook("context", event => {
    for (const name of Object.keys(event.tools)) {
      const server = serverForTool(name)
      if (server && !control.canCall(server)) delete event.tools[name]
    }
  })
  const tool = await ctx.tool.transform(editor => {
    editor.add({
      name: "momo_mcp", options: { pinned: false },
      description: "Inspect project MCP servers or activate/release an on-demand server. Explicit off cannot be overridden. Activation preserves your role's tool permissions. Results are JSON text. Persistent modes are set by the user through /mcp-policy.",
      input: nativeMcpToolInput,
      execute: async (raw, caller) => {
        const role = activeOwnedIDs.has(caller.agent) ? ownedAgentID(caller.agent) : undefined
        if (!role) throw new Error("MCP control requires an owned momo role")
        const input = nativeMcpToolInput.parse(raw)
        if (input.action !== "status") {
          if (role === "momo-advisor" || role === "momo-catalog-researcher") throw new Error("This momo role may inspect MCP state only")
          if (input.action === "activate") await control.activate(input.server, caller.sessionID)
          else await control.release(input.server, caller.sessionID)
        }
        return { content: JSON.stringify(await snapshot()) }
      },
    })
  })
  const rpc = await ctx.rpc.register({ id: "momo.mcp", methods: {
    snapshot: { input: z.object({}).strict(), output: z.object({ servers: z.array(z.unknown()) }) },
    setMode: { input: z.object({ server: z.string().min(1), mode: nativeMcpMode }).strict(), output: z.object({ servers: z.array(z.unknown()) }) },
  }, events: {} }, {
    snapshot,
    setMode: async input => { await control.setMode(input.server, input.mode); return snapshot() },
  })
  return async () => {
    await rpc.dispose()
    await tool.dispose()
    await context.dispose()
    await after.dispose()
    await before.dispose()
    await registration.dispose()
  }
}
