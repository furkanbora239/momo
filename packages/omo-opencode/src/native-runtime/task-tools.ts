import { NativeJevAdmissionError } from "@oh-my-opencode/decision-core"
import { nativeJevApiKey } from "./jev-credentials"
import { createCatalogJobRouting } from "./catalog-job-routing"
import { createNativeModelAdmission } from "./model-admission"
import { z } from "zod"
import { createNativeResearchMaintenance } from "../native-catalog/research-maintenance"
import { createNativeModelPolicyHealth } from "../native-catalog/model-policy-health"
import { createNativeModelPolicyObserver } from "./model-policy-observer"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { createNativeTaskEngine } from "../native-task"
import type { NativeTaskEngine, NativeTaskRole } from "../native-task"
import { createNativeCatalogAdapter, createNativeCatalogKnowledgeStore, createNativePublishedModelReader, registerNativeCatalogKnowledgeTool } from "../native-catalog"
import { createNativeRouter, createJsonlNativeRouterStore } from "../native-routing"
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
import { compactTask, candidatePage, listTasksForCaller, resultPage, taskDetail, taskForCaller } from "./task-tool-output"

const roles = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"] as const
const roleByAgentID = new Map<string, NativeTaskRole>([
  ["momo-orchestrator", "orchestrator"], ["momo-planner", "planner"], ["momo-executor", "executor"],
  ["momo-reviewer", "reviewer"], ["momo-worker", "worker"], ["momo-explore", "explore"],
  ["momo-librarian", "librarian"], ["momo-research", "research"],
  ["momo-catalog-researcher", "catalog-researcher"], ["momo-advisor", "advisor"],
])
const pageInput = { offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(10).optional() }
const inspectionInputs = [
  z.object({ action: z.literal("list"), ...pageInput, includeMaintenance: z.boolean().optional() }),
  z.object({ action: z.literal("candidates"), taskID: z.string(), ...pageInput, role: z.enum([...roles, "advisor"]).optional(), providerID: z.string().optional() }),
  z.object({ action: z.literal("detail"), taskID: z.string() }),
  z.object({ action: z.literal("result"), taskID: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(16384).optional() }),
] as const
const taskInput = z.discriminatedUnion("action", [
  ...inspectionInputs,
  z.object({ action: z.literal("create"), prompt: z.string().min(1), scope: z.string().optional(), acceptance: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("status"), taskID: z.string() }),
  z.object({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), role: z.enum(roles), providerID: z.string(), modelID: z.string() }),
  z.object({ action: z.literal("resume"), taskID: z.string() }),
  z.object({ action: z.literal("answer"), taskID: z.string(), questionID: z.string(), answer: z.unknown() }),
  z.object({ action: z.literal("cancel"), taskID: z.string() }),
])
const consultInput = z.discriminatedUnion("action", [
  ...inspectionInputs,
  z.object({ action: z.literal("start"), prompt: z.string().min(1), scope: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional() }),
  z.object({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), providerID: z.string(), modelID: z.string() }),
  z.object({ action: z.literal("status"), taskID: z.string() }),
  z.object({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional() }),
])

function response(value: unknown): { content: string } {
  return { content: JSON.stringify(value) }
}

function jsonSafe<T>(value: T): T {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("Native RPC output is not JSON serializable")
  return JSON.parse(encoded) as T
}

function modelReference(session: Pick<SessionInfo, "model">): string {
  return session.model === undefined ? "" : `${session.model.providerID}/${session.model.id}`
}


export async function registerNativeTools(ctx: Plugin.Context, activeOwnedIDs: ReadonlySet<string>): Promise<{ engine: NativeTaskEngine; dispose: () => Promise<void> }> {
  const dataRoot = projectNativeRoot(ctx.location.directory)
  const appConfig = loadNativeRuntimeConfig(ctx.location.directory)
  const managerConfig = appConfig.manager ?? ManagerConfigSchema.parse({})
  const repository = createFileNativeTaskRepository(`${dataRoot}/tasks.json`)
  const routerStore = createJsonlNativeRouterStore(`${dataRoot}/routing-ledger.jsonl`, {
    legacyPaths: [join(homeRoot(), ".omo/decision-ledger.jsonl")],
  })
  const knowledgeStore = createNativeCatalogKnowledgeStore(`${homeRoot()}/.omo/native/catalog-knowledge.json`)
  const advisorPool = getAdvisorPoolConfig(ctx.location.directory)
  const modelPolicyHealth = createNativeModelPolicyHealth(`${dataRoot}/model-policy-health.json`)
  const binding = appConfig.catalog?.research_executor
  const maintenance = createNativeResearchMaintenance(`${dataRoot}/catalog-maintenance.json`, {
    executor: binding ? { providerID: binding.providerID, id: binding.modelID } : undefined,
    isEligible: async (model) => (await catalog.catalog.listAvailable()).some((item) => item.available && item.toolCall !== false && item.providerID === model.providerID && item.id === model.id) && await catalog.pool.isAllowed(model),
    isBusy: async () => {
      const tasks = await repository.list()
      if (tasks.some((task) => !task.maintenance && ["awaiting_selection", "running", "queued", "waiting_children", "waiting_question"].includes(task.state))) return true
      const active = await client.session.active()
      return tasks.some((task) => active[task.rootSessionID] !== undefined)
    },
    resume: async (taskID, context) => { if (engine) await engine.resume(taskID, context.rootSessionID) },
    inspect: async (taskID) => (await repository.get(taskID))?.state,
    hasKnowledge: async (model) => knowledgeStore.read(model)?.known === true,
    create: async ({ model, context, executor, taskID }) => {
      if (!engine) throw new Error("Native task engine is not ready for maintenance")
      return engine.createResearch({ taskID, executor, callerSessionID: context.rootSessionID, sourceDecisionID: context.decisionId, prompt: `Research published capabilities, limits, and input/output prices for ${model.providerID}/${model.id}. Cite official documentation and persist verified facts with momo_catalog_enrich. Leave missing facts unknown.`, scope: `Origin decision ${context.decisionId}. Exact model ${model.providerID}/${model.id}. Headless maintenance: do not request caller choices or questions.`, })
    },
  })
  const catalog = createNativeCatalogAdapter({
    context: ctx,
    modelPolicyHealth,
    readMaintenance: () => maintenance.list(),
    homeDirectory: homeRoot(),
    advisorModels: advisorPool.read(),
    routerStore,
    knowledgeStore,
    readPublishedModels: createNativePublishedModelReader({ cachePath: join(homeRoot(), ".omo/native/published-models.json") }),
    researchModel: (model, research) => maintenance.enqueue(model, research),
    onError: (message, error) => console.warn(message, error),
  })
  await catalog.refresh()
  const admission = createNativeModelAdmission({
    context: ctx,
    homeDirectory: homeRoot(),
    catalog,
    managerProviderID: managerConfig.jev.provider_id,
    managerPublicModelID: managerConfig.jev.authentication === "none" ? managerConfig.jev.model : undefined,
    reject: (message) => { throw new NativeJevAdmissionError(message) },
  })
  const disposeSearchFallbacks = await registerNativeSearchFallbacks(ctx, { cwd: ctx.location.directory, homeDirectory: homeRoot() })
  const unregisterCatalog = registerNativeCatalog(ctx.location.directory, catalog)
  const unregisterAdvisorPool = registerNativeAdvisorPool(ctx.location.directory, {
    read: () => advisorPool.read(),
    write(models) {
      advisorPool.write(models)
      catalog.setAdvisorModels(models)
    },
  })
  const jobRouting = createCatalogJobRouting({ directory: ctx.location.directory, catalog, routerStore, managerConfig,
    classes: appConfig.catalog?.job_classes, revision: admission.revision,
    beforeRoutingRequest: admission.beforeRoutingRequest, beforeClassificationRequest: admission.beforeClassificationRequest,
    async getApiKey() {
      await admission.assertManagerProvider()
      try { return await nativeJevApiKey(ctx, managerConfig.jev) }
      catch (error) { throw new NativeJevAdmissionError(error instanceof Error ? error.message : String(error)) }
    },
    onError: error => console.warn("momo catalog classification failed", error),
  })
  const router = createNativeRouter({
    jev: jobRouting.jev,
    accountant: jobRouting.accountant,
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
    beforeModelRequest: admission.beforeModelRequest,
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
    onExecutionFailure: createNativeModelPolicyObserver(sessionRuntime, modelPolicyHealth),
    canRunMaintenance: async (task) => (await client.session.active())[task.rootSessionID] === undefined,
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
      description: "Create, list, inspect, wait, select, resume, answer, or cancel tasks. Returns a JSON STRING: const t = JSON.parse(await tools.momo_task({action: 'create', prompt: '...'})); use t.id. list recovers IDs in your parent/root scope; includeMaintenance reveals internal research. candidates pages eligible choices with runtime rolePermissions separate from modelFacts. Select with taskID, decisionId, role, providerID, modelID. worker edits/runs shell; executor/planner/reviewer coordinate workers. status/wait return bounded result previews: check resultTruncated/resultLength and use result with offset/limit for full text. Execution succeeded does not verify acceptance; verification remains unknown. A wait timeout can return a nonterminal state.",
      input: taskInput,
      execute: async (input, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_task")) throw new Error("This momo role cannot create tasks")
        if (input.action === "list") return response(await listTasksForCaller(repository, tool.sessionID, "task", input))
        if (input.action === "create") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, acceptance: input.acceptance, callerSessionID: tool.sessionID, kind: "task" })
          return response(compactTask(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs)))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "task")
        if (input.action === "candidates") return response(candidatePage(task, input))
        if (input.action === "result") return response(resultPage(task, input))
        if (input.action === "detail") return response(taskDetail(task))
        if (input.action === "status") return response(compactTask(await nativeEngine.status(task.id, tool.sessionID)))
        if (input.action === "wait") return response(compactTask(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs)))
        if (input.action === "select") {
          if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this task")
          return response(compactTask(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, input.role as NativeTaskRole)))
        }
        if (input.action === "resume") return response(compactTask(await nativeEngine.resume(task.id, tool.sessionID)))
        if (input.action === "answer") return response(compactTask(await nativeEngine.answer(task.id, tool.sessionID, input.questionID, input.answer)))
        return response(compactTask(await nativeEngine.cancel(task.id, tool.sessionID)))
      },
    })
    editor.add({
      name: "momo_consult",
      options: { pinned: true },
      description: "Start, list, inspect, select or wait for an advisor consultation. Returns a JSON STRING; parse once with JSON.parse(await tools.momo_consult(...)), then use id. list recovers IDs in your parent/root scope. candidates pages advisor choices; select with taskID, decisionId, providerID, modelID. Advisors are readonly. status/wait contain bounded result previews: check resultTruncated/resultLength and use result offset/limit to recover complete text. Execution success does not verify acceptance. wait may return nonterminal state on timeout.",
      input: consultInput,
      execute: async (input, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_consult")) throw new Error("This momo role cannot consult an advisor")
        if (input.action === "list") return response(await listTasksForCaller(repository, tool.sessionID, "consultation", input))
        if (input.action === "start") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, callerSessionID: tool.sessionID, kind: "consultation" })
          return response(compactTask(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs)))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "consultation")
        if (input.action === "candidates") return response(candidatePage(task, input))
        if (input.action === "result") return response(resultPage(task, input))
        if (input.action === "detail") return response(taskDetail(task))
        if (input.action === "status") return response(compactTask(await nativeEngine.status(task.id, tool.sessionID)))
        if (input.action === "wait") return response(compactTask(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs)))
        if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this consultation")
        return response(compactTask(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, "advisor")))
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
      return { snapshot: jsonSafe({ ...snapshot, classifier: jobRouting.classifier.status() }), providerIDs: await catalog.listProviderIDs() }
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
        if (mapped) {
          await nativeEngine.onEvent(mapped)
          if (["execution.succeeded", "execution.failed", "execution.interrupted"].includes(mapped.type)) await maintenance.pump()
        }
      }).catch((error: unknown) => console.warn("momo native event handling failed", error))
    }
  })()
  await nativeEngine.reconcile()
  await router.recoverResearch()
  await maintenance.pump()
  jobRouting.classifier.start()
  const watchdog = setInterval(() => {
      void Promise.all([nativeEngine.checkWatchdogs(), nativeEngine.retryDeliveries(), maintenance.pump()]).catch((error: unknown) => console.warn("momo native task recovery failed", error))
  }, 30_000)
  return {
    engine: nativeEngine,
    dispose: async () => {
      disposed = true
      clearInterval(watchdog)
      await jobRouting.classifier.stop()
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
