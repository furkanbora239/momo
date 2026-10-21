import { taskDiscoveryInput, consultDiscoveryInput } from "./tool-discovery-input"
import { taskInput, consultInput } from "./tool-operation-inputs"
import { describeNativeTool } from "./tool-operation-help"
import { readNativeToolCapabilities } from "./tool-capabilities"
import { taskToolView } from "./task-tool-brief"
import { createCatalogMaintenanceRunner } from "./catalog-maintenance-runner"
import { createNativeCatalogResearchContext } from "./catalog-research-context"
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
import { createNativeCatalogAdapter, createNativeCatalogKnowledgeStore, createNativeResearchDiscovery, isAutomaticResearchExecutor, hasUsableModelKnowledge, createNativePublishedModelReader, registerNativeCatalogKnowledgeTool } from "../native-catalog"
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

const roleByAgentID = new Map<string, NativeTaskRole>([
  ["momo-orchestrator", "orchestrator"], ["momo-planner", "planner"], ["momo-executor", "executor"],
  ["momo-reviewer", "reviewer"], ["momo-worker", "worker"], ["momo-explore", "explore"],
  ["momo-librarian", "librarian"], ["momo-research", "research"],
  ["momo-catalog-researcher", "catalog-researcher"], ["momo-advisor", "advisor"],
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
  const autoResearch = appConfig.catalog?.auto_research !== false
  const binding = appConfig.catalog?.research_executor
  async function researchExecutor() {
    if (maintenanceRunner.stopping()) return undefined
    if (binding) return { providerID: binding.providerID, id: binding.modelID }
    if (!autoResearch) return undefined
    const models = await catalog.catalog.listAvailable()
    for (const model of [...models].sort((a, b) => `${a.providerID}/${a.id}`.localeCompare(`${b.providerID}/${b.id}`))) {
      if (isAutomaticResearchExecutor(model) && await catalog.pool.isAllowed(model)) return { providerID: model.providerID, id: model.id }
    }
    return undefined
  }
  const maintenance = createNativeResearchMaintenance(`${dataRoot}/catalog-maintenance.json`, {
    executor: binding ? { providerID: binding.providerID, id: binding.modelID } : undefined,
    getExecutor: binding ? undefined : researchExecutor,
    isTargetEligible: async (model) => (await catalog.catalog.listAvailable()).some(item => item.available && item.providerID === model.providerID && item.id === model.id) && await catalog.pool.isAllowed(model),
    isEligible: async (model) => (await catalog.catalog.listAvailable()).some((item) => item.available && item.toolCall !== false && item.providerID === model.providerID && item.id === model.id && (binding !== undefined || autoResearch && isAutomaticResearchExecutor(item))) && await catalog.pool.isAllowed(model),
    isBusy: async () => {
      if (maintenanceRunner.stopping()) return true
      const tasks = await repository.list()
      if (tasks.some((task) => !task.maintenance && ["awaiting_selection", "running", "queued", "waiting_children", "waiting_question"].includes(task.state))) return true
      return researchContext.isBusy()
    },
    resume: async (taskID, context) => { if (engine) await engine.resume(taskID, context.rootSessionID) },
    inspect: async (taskID) => (await repository.get(taskID))?.state,
    hasKnowledge: async (model) => hasUsableModelKnowledge(await catalog.knowledge.get(model)),
    create: async ({ model, context, executor, taskID }) => {
      if (!engine) throw new Error("Native task engine is not ready for maintenance")
      const snapshot = catalog.snapshot(), key = `${model.providerID}/${model.id}`
      const facts = snapshot.models.find(item => item.providerID === model.providerID && item.id === model.id)
      const identity = { transportModelID: snapshot.transportModelIDs[key], canonical: facts?.canonical, name: facts?.displayName, family: facts?.family, description: facts?.published?.description }
      return engine.createResearch({ taskID, executor, callerSessionID: context.rootSessionID, sourceDecisionID: context.decisionId, prompt: `Research the exact model ${model.providerID}/${model.id} from official model cards and documentation. Save a concise summary, strengths and limitations with source URLs using momo_catalog_enrich. Cover coding, research, planning, analysis, writing and image understanding only when documented. Distinguish model capabilities from this endpoint's prices or availability; never infer a free price from another provider. Leave unsupported claims unknown. Current model identity facts: ${JSON.stringify(identity)}.`, scope: `Origin decision ${context.decisionId}. Exact model ${model.providerID}/${model.id}. Headless maintenance: do not request caller choices or questions.`, })
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
    classes: appConfig.catalog?.job_classes, waitForKnowledge: autoResearch, revision: admission.revision,
    beforeRoutingRequest: admission.beforeRoutingRequest, beforeClassificationRequest: admission.beforeClassificationRequest,
    async getApiKey() {
      await admission.assertManagerProvider()
      try { return await nativeJevApiKey(ctx, managerConfig.jev) }
      catch (error) { throw new NativeJevAdmissionError(error instanceof Error ? error.message : String(error)) }
    },
    onError: error => console.warn("momo catalog classification failed", error),
  })
  const router = createNativeRouter({
    authorizeCatalogResearch: async input => autoResearch && !maintenanceRunner.stopping() && input.sourceDecisionID === `catalog-discovery:${input.rootSessionID}` && await researchContext.owns(input.rootSessionID),
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
  const researchContext = createNativeCatalogResearchContext({ directory: ctx.location.directory, identity: `${dataRoot}/catalog-discovery`, sessions: client.session })
  let discoveryStatus: Awaited<ReturnType<ReturnType<typeof createNativeResearchDiscovery>["discover"]>> | undefined
  const discovery = createNativeResearchDiscovery({
    listModels: () => catalog.catalog.listAvailable(),
    isAllowed: model => catalog.pool.isAllowed(model),
    knowledge: model => catalog.knowledge.get(model),
    enqueue: async (model, context) => { if (!maintenanceRunner.stopping()) await maintenance.enqueue(model, context) },
    context: async () => {
      const executor = await researchExecutor()
      return executor && !maintenanceRunner.stopping() ? researchContext.context() : undefined
    },
  })
  const maintenanceRunner = createCatalogMaintenanceRunner({
    discover: async () => { if (autoResearch) discoveryStatus = await discovery.discover() },
    pump: () => maintenance.pump(),
  })
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
    canRunMaintenance: async (task) => {
      if (maintenanceRunner.stopping() || await researchContext.isBusy()) return false
      if (!autoResearch && task.sourceDecisionID?.startsWith("catalog-discovery:")) return false
      if (binding) return (await client.session.active())[task.rootSessionID] === undefined
      return autoResearch && (await catalog.catalog.listAvailable()).some(model => isAutomaticResearchExecutor(model) && model.providerID === task.model?.providerID && model.id === task.model.id)
    },
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
      options: { pinned: false },
      description: "Manage native tasks. First use action: help for current operations, or capabilities for role and advisor availability. JSON STRING results: parse once. Use view: brief for monitoring; follow nextActions and nextOffset. Missing input uses native question, answered by the parent with answer.",
      input: taskDiscoveryInput,
      execute: async (rawInput, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_task")) throw new Error("This momo role cannot create tasks")
        const input = taskInput.parse(rawInput)
        if (input.action === "help") return response(describeNativeTool({ tool: "momo_task", role: roleByAgentID.get(role)!, operation: input.operation }))
        if (input.action === "capabilities") return response(await readNativeToolCapabilities({ agent: role, advisors: advisorPool.read(), available: await catalog.catalog.listAvailable(), isAllowed: async model => await catalog.pool.isAllowed(model) && (await catalog.pool.isConsultationAllowed?.(model) ?? true) }))
        if (input.action === "list") return response(await listTasksForCaller(repository, tool.sessionID, "task", input))
        if (input.action === "create") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, acceptance: input.acceptance, callerSessionID: tool.sessionID, kind: "task" })
          return response(taskToolView(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs), input.view, tool.sessionID))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "task")
        if (input.action === "candidates") return response(candidatePage(task, input))
        if (input.action === "result") return response(resultPage(task, input))
        if (input.action === "detail") return response(taskDetail(task))
        if (input.action === "status") return response(taskToolView(await nativeEngine.status(task.id, tool.sessionID), input.view, tool.sessionID))
        if (input.action === "wait") return response(taskToolView(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs), input.view, tool.sessionID))
        if (input.action === "select") {
          if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this task")
          return response(taskToolView(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, input.role as NativeTaskRole), input.view, tool.sessionID))
        }
        if (input.action === "resume") return response(taskToolView(await nativeEngine.resume(task.id, tool.sessionID), input.view, tool.sessionID))
        if (input.action === "answer") return response(taskToolView(await nativeEngine.answer(task.id, tool.sessionID, input.questionID, input.answer), input.view, tool.sessionID))
        return response(taskToolView(await nativeEngine.cancel(task.id, tool.sessionID), input.view, tool.sessionID))
      },
    })
    editor.add({
      name: "momo_consult",
      options: { pinned: false },
      description: "Consult another configured model for advice. First use action: capabilities to check availability, or help for the current contract. JSON STRING results: parse once. Use view: brief for monitoring. Workers may consult; advisors cannot. Missing user input belongs in native question rather than a consultation.",
      input: consultDiscoveryInput,
      execute: async (rawInput, tool) => {
        const role = activeOwnedIDs.has(tool.agent) ? ownedAgentID(tool.agent) : undefined
        if (role === undefined || !nativeToolAllowed(role, "momo_consult")) throw new Error("This momo role cannot consult an advisor")
        const input = consultInput.parse(rawInput)
        if (input.action === "help") return response(describeNativeTool({ tool: "momo_consult", role: roleByAgentID.get(role)!, operation: input.operation }))
        if (input.action === "capabilities") return response(await readNativeToolCapabilities({ agent: role, advisors: advisorPool.read(), available: await catalog.catalog.listAvailable(), isAllowed: async model => await catalog.pool.isAllowed(model) && (await catalog.pool.isConsultationAllowed?.(model) ?? true) }))
        if (input.action === "list") return response(await listTasksForCaller(repository, tool.sessionID, "consultation", input))
        if (input.action === "start") {
          const created = await nativeEngine.create({ prompt: input.prompt, scope: input.scope, callerSessionID: tool.sessionID, kind: "consultation" })
          return response(taskToolView(input.waitMs === undefined ? created : await nativeEngine.wait(created.id, tool.sessionID, input.waitMs), input.view, tool.sessionID))
        }
        const task = await taskForCaller(repository, input.taskID, tool.sessionID, "consultation")
        if (input.action === "candidates") return response(candidatePage(task, input))
        if (input.action === "result") return response(resultPage(task, input))
        if (input.action === "detail") return response(taskDetail(task))
        if (input.action === "status") return response(taskToolView(await nativeEngine.status(task.id, tool.sessionID), input.view, tool.sessionID))
        if (input.action === "wait") return response(taskToolView(await nativeEngine.wait(task.id, tool.sessionID, input.timeoutMs), input.view, tool.sessionID))
        if (task.decisionId !== input.decisionId) throw new Error("Decision ID does not match this consultation")
        return response(taskToolView(await nativeEngine.select(task.id, tool.sessionID, { providerID: input.providerID, id: input.modelID }, "advisor"), input.view, tool.sessionID))
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
      return { snapshot: jsonSafe({ ...snapshot, discovery: discoveryStatus, classifier: jobRouting.classifier.status() }), providerIDs: await catalog.listProviderIDs() }
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
  void maintenanceRunner.run().catch(error => console.warn("momo catalog discovery failed", error))
  jobRouting.classifier.start()
  const watchdog = setInterval(() => {
      void Promise.all([nativeEngine.checkWatchdogs(), nativeEngine.retryDeliveries(), maintenanceRunner.run()]).catch((error: unknown) => console.warn("momo native task recovery failed", error))
  }, 30_000)
  return {
    engine: nativeEngine,
    dispose: async () => {
      disposed = true
      clearInterval(watchdog)
      await maintenanceRunner.stop()
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
