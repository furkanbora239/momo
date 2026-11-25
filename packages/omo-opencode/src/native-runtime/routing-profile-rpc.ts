import type { Plugin } from "@opencode/plugin"
import { z } from "zod"
import type { ManagerConfig } from "../config/schema/decision-engine"
import type { createNativeControlStores, NativeCatalogAdapter } from "../native-catalog"
import type { NativeRouter } from "../native-routing/router"
import { isProviderDisabled, setProviderDisabled } from "../shared/provider-toggles"
import type { createNativeModelAdmission } from "./model-admission"
import { routingModel, routingProfile, routingProfileID, type createRoutingProfileStore } from "./routing-profile"
import type { createRoutingAssistant } from "./routing-assistant"

const providerRow = z.object({
  id: z.string(), allowed: z.boolean(), connected: z.boolean(), reason: z.string().optional(), until: z.number().optional(),
})
const modelRow = z.object({
  ...routingModel.shape,
  available: z.boolean(), type: z.string().optional(), displayName: z.string().optional(), toolCall: z.boolean().optional(),
  inputPricePerMillion: z.number().optional(), outputPricePerMillion: z.number().optional(), reason: z.string().optional(),
})
export const routingStatus = z.object({
  revision: z.string(), active: routingProfileID, profiles: z.partialRecord(routingProfileID, routingProfile), legacy: routingProfile,
  jev: z.object({ label: z.string(), available: z.boolean(), reason: z.string().optional(), retryAt: z.number().optional() }),
  models: z.array(modelRow), providers: z.array(providerRow),
  lastDecision: z.object({
    status: z.string(), reason: z.string().optional(), selected: z.object({ model: routingModel, role: z.string(), by: z.string() }).optional(),
  }).optional(),
})
export type RoutingStatus = z.infer<typeof routingStatus>

export const routingSuggestion = z.object({
  decision: routingModel, workers: z.array(routingModel),
  reasons: z.object({ decision: z.string(), workers: z.string() }),
})

export function registerRoutingProfileRpc(ctx: Pick<Plugin.Context, "rpc">, deps: {
  profiles: ReturnType<typeof createRoutingProfileStore>
  assistant: ReturnType<typeof createRoutingAssistant>
  catalog: Pick<NativeCatalogAdapter, "refresh" | "listProviderIDs">
  manager: ManagerConfig["jev"]
  controls: ReturnType<typeof createNativeControlStores>
  admission: Pick<ReturnType<typeof createNativeModelAdmission>, "assertManagerProvider">
  router: Pick<NativeRouter, "status">
}) {
  const { profiles, catalog, manager, controls } = deps
  async function snapshot(): Promise<RoutingStatus> {
    const [catalogue, providerIDs, history] = await Promise.all([catalog.refresh(), catalog.listProviderIDs(), deps.router.status()])
    const toggles = controls.readProviderToggles()
    const status = await deps.admission.assertManagerProvider().then(
      () => ({ available: history.jevRetryAt === undefined, reason: history.jevRetryAt ? "Jev circuit breaker is open" : undefined }),
      (error: unknown) => ({ available: false, reason: error instanceof Error ? error.message.slice(0, 240) : "Jev provider unavailable" }),
    )
    const { revision, active, profiles: saved } = profiles.read()
    const result = routingStatus.parse({
      revision, active, profiles: saved, legacy: profiles.legacy(),
      jev: { label: `${manager.provider_id}/${manager.model}`, ...status, retryAt: history.jevRetryAt },
      lastDecision: history.lastDecision,
      models: catalogue.models.map(model => ({
        ...model, reason: catalogue.unavailableModels?.[`${model.providerID}/${model.id}`]?.reason.slice(0, 240),
      })),
      providers: providerIDs.map(id => ({
        id, allowed: !isProviderDisabled(toggles, id), connected: catalogue.connectedProviders.includes(id),
        reason: catalogue.unavailableProviders[id]?.reason?.slice(0, 240), until: catalogue.unavailableProviders[id]?.until,
      })),
    })
    return JSON.parse(JSON.stringify(result)) as RoutingStatus
  }

  return ctx.rpc.register({
    id: "momo.routing",
    methods: {
      snapshot: { input: z.strictObject({}), output: routingStatus },
      save: { input: z.strictObject({ revision: z.string(), profileID: routingProfileID, profile: routingProfile }), output: z.object({ revision: z.string() }) },
      suggest: { input: z.strictObject({ model: routingModel, profileID: routingProfileID }), output: routingSuggestion },
      provider: { input: z.strictObject({ providerID: z.string().min(1), allowed: z.boolean() }), output: z.strictObject({}) },
    },
    events: {},
  }, {
    snapshot,
    async save({ revision, profileID, profile }) {
      const state = profiles.read()
      if (state.revision !== revision) throw new Error("Routing settings changed. Reopen the panel to get the latest settings.")
      const valid = await deps.assistant.validate(profile, state.profiles[profileID] ?? profiles.legacy())
      return { revision: profiles.save(revision, profileID, valid).revision }
    },
    suggest: input => deps.assistant.suggest(input.model, input.profileID),
    async provider({ providerID, allowed }) {
      if (!(await catalog.listProviderIDs()).includes(providerID)) throw new Error("Provider is no longer registered in OpenCode")
      controls.writeProviderToggles(setProviderDisabled(controls.readProviderToggles(), providerID, !allowed))
      return {}
    },
  })
}
