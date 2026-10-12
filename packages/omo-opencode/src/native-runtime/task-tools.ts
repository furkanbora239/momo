import { z } from "zod"
import type { Plugin } from "@opencode/plugin"
import { createNativeTaskEngine } from "../native-task"
import type { NativeTaskEngine, NativeTaskRole } from "../native-task"
import { createNativeCatalogAdapter, createNativeCatalogKnowledgeStore, registerNativeCatalogKnowledgeTool } from "../native-catalog"
import { createNativeRouter, createNativeJevBackend, createJsonlNativeRouterStore } from "../native-routing"
import { createFileNativeTaskRepository } from "../native-task"
import { createNativeSessionRuntime } from "./session-runtime"
import { mapV2TaskEvent } from "../native-task"
import { nativeToolAllowed, ownedAgentID } from "./role-policy"
import { projectNativeRoot } from "./user-data-paths"
import { homeRoot } from "./user-data-paths"
import { ManagerConfigSchema } from "../config/schema/decision-engine"
import { registerNativeAdvisorPool, registerNativeCatalog } from "./catalog-registry"
import { getAdvisorPool as getAdvisorPoolConfig } from "./advisor-pool-config"
import { discoverNativeV2Client } from "./v2-service-client"
import { registerNativeSearchFallbacks } from "../native-search/fallback"
import type { SessionInfo } from "@opencode/client"
import { loadNativeRuntimeConfig } from "./native-config"

const roles = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"] as const
const roleByAgentID = new Map<string, NativeTaskRole>([
  ["momo-orchestrator", "orchestrator"], ["momo-planner", "planner"], ["momo-executor", "executor"],
  ["momo-reviewer", "reviewer"], ["momo-worker", "worker"], ["momo-explore", "explore"],
  ["momo-librarian", "librarian"], ["momo-research", "research"],
  ["momo-catalog-researcher", "catalog-researcher"], ["momo-advisor", "advisor"],
])
const taskInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), prompt: z.string().min(1), scope: z.string().optional(), acceptance: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("status"), taskID: z.string() }),
  z.object({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), role: z.enum(roles), providerID: z.string(), modelID: z.string() }),
  z.object({ action: z.literal("resume"), taskID: z.string() }),
  z.object({ action: z.literal("answer"), taskID: z.string(), questionID: z.string(), answer: z.unknown() }),
  z.object({ action: z.literal("cancel"), taskID: z.string() }),
])
const consultInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), prompt: z.string().min(1), scope: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), providerID: z.string(), modelID: z.string() }),
  z.object({ action: z.literal("status"), taskID: z.string() }),
  z.object({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional() }),
])

function response(value: unknown): { content: string } {
  return { content: JSON.stringify(value, null, 2) }
}

function jsonSafe<T>(value: T): T {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("Native RPC output is not JSON serializable")
  return JSON.parse(encoded) as T
}

function modelReference(session: Pick<SessionInfo, "model">): string {
  return session.model === undefined ? "" : `${session.model.providerID}/${session.model.id}`
}

async function taskForCaller(
  repository: ReturnType<typeof createFileNativeTaskRepository>,
  taskID: string,
  callerSessionID: string,
  kind: "task" | "consultation",
) {
  const task = await repository.get(taskID)
  if (!task || task.kind !== kind) throw new Error(`No ${kind} exists with that task ID`)
  if (task.parentSessionID !== callerSessionID && task.rootSessionID !== callerSessionID) throw new Error("Task access is limited to its parent session and root session")
  return task
}

async function nativeApiKey(ctx: Plugin.Context, providerID: string): Promise<string> {
  const providers = await ctx.provider.list()
  const provider = providers.data.find((item) => item.id === providerID)
  if (!provider) throw new Error(`OpenCode provider ${providerID} is not registered`)
  const integrationID = provider.integrationID
  if (!integrationID) {
    const configuredKey = provider.settings?.apiKey
    if (typeof configuredKey === "string" && configuredKey.length > 0) return configuredKey
    throw new Error(`OpenCode provider ${providerID} has no native integration connection or configured API key`)
  }
  const connection = await ctx.integration.connection.active(integrationID)
  if (!connection) throw new Error(`OpenCode provider ${providerID} is not connected`)
  const credential = await ctx.integration.connection.resolve(connection)
  if (!credential) throw new Error(`OpenCode provider ${providerID} has no active credential`)
  if (credential.type === "key") return credential.key
  return credential.access
}

export async function registerNativeTools(ctx: Plugin.Context, activeOwnedIDs: ReadonlySet<string>): Promise<{ engine: NativeTaskEngine; dispose: () => Promise<void> }> {
  const dataRoot = projectNativeRoot(ctx.location.directory)
  const appConfig = loadNativeRuntimeConfig(ctx.location.directory)
  const managerConfig = appConfig.manager ?? ManagerConfigSchema.parse({})
  const repository = createFileNativeTaskRepository(`${dataRoot}/tasks.json`)
  const routerStore = createJsonlNativeRouterStore(`${dataRoot}/routing-ledger.jsonl`)
  const knowledgeStore = createNativeCatalogKnowledgeStore(`${homeRoot()}/.omo/native/catalog-knowledge.json`)
  const advisorPool = getAdvisorPoolConfig(ctx.location.directory)
  const catalog = createNativeCatalogAdapter({
    context: ctx,
    homeDirectory: homeRoot(),
    advisorModels: advisorPool.read(),
    routerStore,
    knowledgeStore,
    researchModel: async (model, research) => {
      if (engine === undefined || research.decisionId.length === 0) return
      await engine.createResearch({
        prompt: `Research the published capabilities and limits of ${model.providerID}/${model.id}. Save only claims supported by URLs from official model or provider documentation using momo_catalog_enrich.`,
        scope: `Origin decision ${research.decisionId}. Research one model profile, cite public documentation URLs, and do not run coding tasks.`,
        callerSessionID: research.rootSessionID,
        sourceDecisionID: research.decisionId,
      })
    },
    onError: (message, error) => console.warn(message, error),
  })
  await catalog.refresh()
  const disposeSearchFallbacks = await registerNativeSearchFallbacks(ctx, { cwd: ctx.location.directory, homeDirectory: homeRoot() })
  const unregisterCatalog = registerNativeCatalog(ctx.location.directory, catalog)
  const unregisterAdvisorPool = registerNativeAdvisorPool(ctx.location.directory, {
    read: () => advisorPool.read(),
    write(models) {
      advisorPool.write(models)
      catalog.setAdvisorModels(models)
    },
  })
  const router = createNativeRouter({
    jev: createNativeJevBackend({
      session: "momo-native-routing",
      getApiKey: () => nativeApiKey(ctx, managerConfig.jev.provider_id),
      baseUrl: managerConfig.jev.base_url,
      model: managerConfig.jev.model,
      maxAttempts: managerConfig.jev.max_attempts,
    }),
    ...catalog,
    store: routerStore,
    config: {
      getAdvisorModels: () => advisorPool.read(),
      confidenceThreshold: managerConfig.jev.confidence_threshold,
      breakerFailures: managerConfig.jev.circuit_breaker.failures,
      breakerCooldownMs: managerConfig.jev.circuit_breaker.cooldown_ms,
      monthlyBudgetUsd: managerConfig.jev.budget.monthly_cap_usd,
    },
    onError: (message) => console.warn(message),
  })
  const config = loadNativeRuntimeConfig(ctx.location.directory).background_task
  const client = await discoverNativeV2Client()
  let engine: NativeTaskEngine | undefined
  const sessionRuntime = createNativeSessionRuntime({
    client,
    repository,
    resolveOwnedRole: (session) => session.agent !== undefined && activeOwnedIDs.has(session.agent) ? roleByAgentID.get(session.agent) : undefined,
    resolveOwnedAgentID: (role) => activeOwnedIDs.has(`momo-${role}`) ? `momo-${role}` : undefined,
    verifySessionOwner: async (session) => {
      const local = await ctx.session.get({ sessionID: session.id })
      if (local.id !== session.id || local.projectID !== session.projectID || local.parentID !== session.parentID || local.agent !== session.agent || local.location.directory !== session.location.directory || modelReference(local) !== modelReference(session)) {
        throw new Error("Discovered OpenCode service does not own this active plugin session")
      }
    },
    onParentAnswer: async (taskID, questionID, answer, replyingSessionID) => {
      if (engine === undefined) throw new Error("Native task engine is not ready to accept form replies")
      await engine.answer(taskID, replyingSessionID, questionID, answer)
    },
    onEvent: async (event) => {
      if (engine !== undefined) await engine.onEvent(event)
    },
  })
  const nativeEngine = createNativeTaskEngine({
    repository,
    router,
    runtime: sessionRuntime,
    defaultConcurrency: config?.defaultConcurrency ?? 5,
    providerConcurrency: config?.providerConcurrency,
    modelConcurrency: config?.modelConcurrency,
    activeToolTimeoutMs: config?.activeToolTimeoutMs ?? 3_600_000,
    silenceTimeoutMs: config?.staleTimeoutMs,
  })
  engine = nativeEngine
  const toolRegistration = await ctx.tool.transform((editor) => {
    for (const tool of editor.list()) {
      if (tool.id === "momo_task" || tool.id === "momo_consult" || tool.id.startsWith("momo_task_") || tool.id.startsWith("momo_consult_")) {
        editor.remove(tool.id)
      }
    }
    editor.add({
      name: "momo_task",
      options: { pinned: true },
      description: "Create, inspect, wait for, select, resume, answer, or cancel a momo task.",
      input: taskInput,
      execute: async (input, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_task")) throw new Error("This momo role cannot create tasks")
        if (input.action === "create") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, acceptance: input.acceptance, callerSessionID: tool.sessionID, kind: "task" })
          return response(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "task")
        if (input.action === "status") return response(await nativeEngine.status(task.id, tool.sessionID))
        if (input.action === "wait") return response(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs))
        if (input.action === "select") {
          if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this task")
          return response(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, input.role as NativeTaskRole))
        }
        if (input.action === "resume") return response(await nativeEngine.resume(task.id, tool.sessionID))
        if (input.action === "answer") return response(await nativeEngine.answer(task.id, tool.sessionID, input.questionID, input.answer))
        return response(await nativeEngine.cancel(task.id, tool.sessionID))
      },
    })
    editor.add({
      name: "momo_consult",
      options: { pinned: true },
      description: "Start or inspect a bounded consultation using only the explicitly allowed advisor model pool.",
      input: consultInput,
      execute: async (input, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_consult")) throw new Error("This momo role cannot consult an advisor")
        if (input.action === "start") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, callerSessionID: tool.sessionID, kind: "consultation" })
          return response(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "consultation")
        if (input.action === "status") return response(await nativeEngine.status(task.id, tool.sessionID))
        if (input.action === "wait") return response(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs))
        if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this consultation")
        return response(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, "advisor"))
      },
    })
  })
  const rpcRegistration = await ctx.rpc.register({
    id: "momo.native",
    methods: {
      tasks: { input: z.object({ rootSessionID: z.string().min(1) }), output: z.object({ tasks: z.array(z.unknown()) }) },
      exportDecisions: { input: z.object({}), output: z.object({ lines: z.array(z.string()) }) },
      catalogSnapshot: { input: z.object({}), output: z.object({ snapshot: z.unknown(), providerIDs: z.array(z.string()) }) },
    },
    events: {},
  }, {
    tasks: async (input) => {
      const all = await repository.list()
      return { tasks: jsonSafe(all.filter((task) => task.rootSessionID === input.rootSessionID)) }
    },
    exportDecisions: async () => ({ lines: [...await router.exportLedger()] }),
    catalogSnapshot: async () => {
      const snapshot = await catalog.refresh()
      return { snapshot: jsonSafe(snapshot), providerIDs: await catalog.listProviderIDs() }
    },
  })
  const disposeKnowledgeTool = await registerNativeCatalogKnowledgeTool(ctx, knowledgeStore, (agentID) => agentID === "momo-catalog-researcher" && activeOwnedIDs.has(agentID))
  let disposed = false
  const iterator = ctx.event.subscribe()[Symbol.asyncIterator]()
  let eventQueue = Promise.resolve()
  const eventLoop = (async () => {
    while (!disposed) {
      const next = await iterator.next()
      if (next.done) break
      const event = next.value
      eventQueue = eventQueue.then(async () => {
        const isFormEvent = event.type === "form.created" || event.type === "form.replied"
        const wasHandled = isFormEvent ? await sessionRuntime.onFormEvent(event) : false
        if (wasHandled) return
        const mapped = mapV2TaskEvent(event)
        if (mapped) await nativeEngine.onEvent(mapped)
      }).catch((error: unknown) => console.warn("momo native event handling failed", error))
    }
  })()
  await nativeEngine.reconcile()
  const watchdog = setInterval(() => {
      void Promise.all([nativeEngine.checkWatchdogs(), nativeEngine.retryDeliveries()]).catch((error: unknown) => console.warn("momo native task recovery failed", error))
  }, 30_000)
  return {
    engine: nativeEngine,
    dispose: async () => {
      disposed = true
      clearInterval(watchdog)
      await iterator.return?.()
      await eventLoop
      await toolRegistration.dispose()
      await rpcRegistration.dispose()
      await disposeKnowledgeTool()
      await disposeSearchFallbacks()
      unregisterCatalog()
      unregisterAdvisorPool()
    },
  }
}
