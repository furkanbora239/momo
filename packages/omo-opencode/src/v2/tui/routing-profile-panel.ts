import type { KeymapCommand } from "@opencode/plugin/tui/context"
import { routingStatus, routingSuggestion, type RoutingStatus } from "../../native-runtime/routing-profile-rpc"
import type { RoutingProfile, RoutingProfileID } from "../../native-runtime/routing-profile"
import type { V2TuiContext } from "./types"
import { chatReady, modelIssue, modelLabel, pickRoutingModel, pickRoutingModels, workerReady } from "./routing-model-picker"
import type { createRoutingStatusPanel } from "./routing-status-panel"

const profileTitles: Record<RoutingProfileID, string> = { auto: "Automatic", chatgpt: "ChatGPT", go: "OpenCode Go" }
const poolTitles = { all: "All eligible models", allowlist: "Only selected models", paused: "Pause delegation" } as const
type Section = "decision" | "pool" | "providers" | "advisors" | "research" | "profile" | "suggest" | "missing" | "connect" | "models" | "refresh" | "apply" | "status"
const descriptions = {
  decision: "Chooses the role and model for each delegated task.",
  pool: "Models allowed to run delegated tasks and use tools.",
  advisors: "Optional second opinion for difficult decisions.",
  research: "Optional background model research. Jev profiles can also classify the catalog.",
}

function initialDraft(status: RoutingStatus, id: RoutingProfileID): RoutingProfile {
  return status.profiles[id] ?? (id === "auto" ? status.legacy : {
    decision: { kind: "manual" }, pool: { mode: "allowlist", models: [] }, advisors: [], research: { kind: "off" },
  })
}

function dispatchNative(ctx: V2TuiContext, slash: string) {
  const command = ctx.keymap.commands().find(item => item.slash?.name === slash)
  if (command?.id) ctx.keymap.dispatch(command.id)
  else ctx.ui.toast.show({ variant: "info", message: `Use /${slash} in the OpenCode prompt.` })
}

export function routingProfileCommands(ctx: V2TuiContext, panel: ReturnType<typeof createRoutingStatusPanel>): KeymapCommand[] {
  const directory = ctx.location?.directory
  if (!directory) return []
  type Input = NonNullable<Parameters<V2TuiContext["client"]["rpc"]["call"]>[0]["input"]>
  const rpc = async (method: string, input: Input = {}) =>
    (await ctx.client.rpc.call({ rpcID: "momo.routing", method, location: { directory }, input })).output
  const readStatus = async () => routingStatus.parse(await rpc("snapshot"))

  async function providerPanel(status: RoutingStatus) {
    const provider = await ctx.ui.dialog.select({
      title: "Momo routing providers",
      placeholder: "Manage delegation eligibility · /connect manages accounts",
      options: status.providers.map(row => ({
        value: row, title: `${row.id} · ${row.allowed ? "Allowed" : "Excluded"}`,
        description: row.reason ?? (row.connected ? "Available in the OpenCode catalog; quota may apply" : "No available models"),
        footer: row.until ? `Retry after ${new Date(row.until).toLocaleTimeString()}` : undefined,
      })),
    })
    if (!provider) return status
    const action = provider.allowed ? "Exclude from routing" : "Allow for routing"
    if (!await ctx.ui.dialog.confirm({ title: provider.id, message: "This provider permission applies to all Momo projects.", label: { confirm: action } })) return status
    await rpc("provider", { providerID: provider.id, allowed: !provider.allowed })
    return readStatus()
  }

  async function chooseDecision(status: RoutingStatus, draft: RoutingProfile): Promise<RoutingProfile["decision"]> {
    const current = draft.decision
    const kind = await ctx.ui.dialog.select({
      title: "Decision model",
      options: [
        { value: "jev", title: "Configured Jev", description: status.jev.reason ?? status.jev.label },
        { value: "chat", title: "Chat model", description: "Use a connected chat model to select from eligible routes." },
        { value: "manual", title: "Caller selection", description: "Offer eligible routes on each task for manual selection." },
        { value: "fallback", title: "Edit backup decision model", description: "Used when the chosen decision backend fails or is unavailable.", disabled: current.kind === "manual" },
        { value: "clear", title: "Remove backup", disabled: current.kind === "manual" || !current.fallback },
      ],
    })
    if (kind === "manual") return { kind: "manual" }
    if (kind === "jev") return { kind: "jev", ...(current.kind !== "manual" && current.fallback ? { fallback: current.fallback } : {}) }
    if (kind === "clear" && current.kind !== "manual") return { ...current, fallback: undefined }
    if (kind !== "chat" && kind !== "fallback") return current
    const options = status.models.filter(row => chatReady(row) && (kind !== "fallback" || current.kind !== "chat" || modelLabel(row) !== modelLabel(current.model)))
    const model = await pickRoutingModel(ctx, kind === "chat" ? "Choose decision model" : "Choose backup decision model", options)
    if (!model) return current
    if (kind === "fallback") return current.kind === "manual" ? current : { ...current, fallback: model }
    const fallback = current.kind !== "manual" && current.fallback && modelLabel(current.fallback) !== modelLabel(model) ? current.fallback : undefined
    return { kind: "chat", model, fallback }
  }

  async function choosePool(status: RoutingStatus, draft: RoutingProfile): Promise<RoutingProfile["pool"]> {
    const mode = await ctx.ui.dialog.select({
      title: "Worker model pool",
      current: draft.pool.mode,
      options: [{ value: "all" as const, title: poolTitles.all }, { value: "allowlist" as const, title: poolTitles.allowlist }, { value: "paused" as const, title: poolTitles.paused }],
    })
    if (!mode) return draft.pool
    if (mode !== "allowlist") return { mode, models: draft.pool.models }
    const models = await pickRoutingModels(ctx, "Select worker models", status, draft.pool.models)
    return models ? { mode, models } : draft.pool
  }

  async function chooseResearch(status: RoutingStatus, draft: RoutingProfile): Promise<RoutingProfile["research"]> {
    const kind = await ctx.ui.dialog.select({
      title: "Catalog maintenance",
      options: [
        { value: "off", title: "Off", description: "Pause model research and background Jev classification." },
        { value: "inherit", title: "Inherit catalog settings", description: "Use the configured researcher or eligible verified-free research models." },
        { value: "chat", title: "Choose research model", description: "This model can be called in the background and consume usage." },
      ],
    })
    if (kind === "off" || kind === "inherit") return { kind }
    if (kind !== "chat") return draft.research
    const model = await pickRoutingModel(ctx, "Choose research model", status.models.filter(workerReady))
    return model ? { kind, model } : draft.research
  }

  async function open(start?: Section) {
    let status = await readStatus()
    const revision = status.revision
    let id = status.active
    const drafts = new Map<RoutingProfileID, RoutingProfile>()
    let draft = initialDraft(status, id)
    let explanations: { decision: string; workers: string } | undefined
    let next = start
    for (;;) {
      const main = ctx.ui.model?.current()
      const availableWorkers = status.models.filter(workerReady)
      const ready = draft.pool.mode === "paused" ? 0 : draft.pool.mode === "all" ? availableWorkers.length
        : draft.pool.models.filter(model => !modelIssue(status, model, workerReady)).length
      const decision = draft.decision
      const decisionIssue = decision.kind === "chat" ? modelIssue(status, decision.model) : decision.kind === "jev" ? status.jev.reason : undefined
      const decisionLabel = decision.kind === "manual" ? "Caller selection" : decision.kind === "jev" ? status.jev.label : modelLabel(decision.model)
      const draftChanged = status.active !== id || JSON.stringify(initialDraft(status, id)) !== JSON.stringify(draft)
      const overview = () => {
        const result = ctx.ui.dialog.select<Section>({
          title: `Momo routing · ${profileTitles[id]}${draftChanged ? " · Draft" : ""}`,
          placeholder: "Search routing settings",
          options: [
            { value: "models", title: `Main model · ${main ? `${main.providerID}/${main.modelID}` : "Select in OpenCode"}`, footer: "Starts tasks and combines their results." },
            { value: "decision", title: `Decision model · ${decisionLabel}`, description: decisionIssue ? "Unavailable" : decision.kind === "manual" ? "Manual" : "Configured",
              footer: [decisionIssue, explanations?.decision ?? descriptions.decision,
                decision.kind !== "manual" && decision.fallback ? `Backup ${modelLabel(decision.fallback)}${modelIssue(status, decision.fallback) ? " · unavailable" : ""}` : undefined].filter(Boolean).join(" · ") },
            { value: "pool", title: `Worker pool · ${ready} eligible`, description: poolTitles[draft.pool.mode], footer: explanations?.workers ?? descriptions.pool },
            ...(draftChanged ? [{ value: "apply" as const, title: "Apply profile", description: "Activate the current draft for this project." }] : []),
            { value: "suggest", title: "Fill with AI", description: "Ask a model to prepare a decision and worker draft." },
            { value: "profile", title: "Switch profile", description: `Active profile: ${profileTitles[status.active]}`, category: "Setup" },
            { value: "providers", title: "Routing provider access", description: "Check connection and Momo eligibility.", category: "Setup" },
            { value: "connect", title: "Connect an OpenCode account", category: "Setup" },
            { value: "missing", title: "Fill unavailable choices with AI", description: "Replace unavailable choices and keep working models.", category: "Setup" },
            { value: "refresh", title: "Refresh catalog", description: "Recheck provider and model availability.", category: "Setup" },
            { value: "status", title: "Show alongside session", description: status.lastDecision?.reason ?? "View saved routing status.", category: "Setup" },
            { value: "advisors", title: `Advisors · ${draft.advisors.length} configured`, footer: descriptions.advisors, category: "Optional" },
            { value: "research", title: `Catalog maintenance · ${draft.research.kind === "chat" ? modelLabel(draft.research.model) : draft.research.kind}`, footer: descriptions.research, category: "Optional" },
          ],
        })
        ctx.ui.dialog.set({ size: "xlarge" })
        return result
      }
      const section: Section | undefined = next ?? await overview()
      next = undefined
      if (section === undefined) return
      if (section === "connect" || section === "models") { dispatchNative(ctx, section); return }
      if (section === "refresh") { status = await readStatus(); continue }
      if (section === "status") { if (await panel.show(await readStatus())) return; continue }
      if (section === "providers") { status = await providerPanel(status); continue }
      if (section === "decision") draft = { ...draft, decision: await chooseDecision(status, draft) }
      if (section === "pool") draft = { ...draft, pool: await choosePool(status, draft) }
      if (section === "advisors") draft = { ...draft, advisors: await pickRoutingModels(ctx, "Select advisor models", status, draft.advisors) ?? draft.advisors }
      if (section === "research") draft = { ...draft, research: await chooseResearch(status, draft) }
      if (section === "profile") {
        const profile = await ctx.ui.dialog.select({
          title: "Routing profiles", current: id,
          options: (Object.keys(profileTitles) as RoutingProfileID[]).map(value => ({
            value, title: profileTitles[value], description: status.active === value ? "Active" : status.profiles[value] ? "Saved" : "New profile",
          })),
        })
        if (!profile || profile === id) continue
        drafts.set(id, draft)
        id = profile
        draft = drafts.get(id) ?? initialDraft(status, id)
        explanations = undefined
      }
      if (section === "suggest" || section === "missing") {
        const model = await pickRoutingModel(ctx, "Choose AI to prepare the routing draft", status.models.filter(chatReady),
          main && { providerID: main.providerID, id: main.modelID })
        if (!model) continue
        try {
          const suggested = routingSuggestion.parse(await rpc("suggest", { model: { ...model }, profileID: id }))
          const replace = section === "suggest"
          const kept = draft.pool.models.filter(item => !modelIssue(status, item, workerReady))
          const workers = [...new Map([...kept, ...suggested.workers].map(item => [modelLabel(item), item])).values()]
          const currentBackup = decision.kind !== "manual" ? decision.fallback : undefined
          const changeDecision = replace || decisionIssue !== undefined || (!status.profiles[id] && decision.kind === "manual")
          let nextDecision = decision
          if (changeDecision) {
            const backup = currentBackup && !modelIssue(status, currentBackup) && modelLabel(currentBackup) !== modelLabel(suggested.decision)
              ? currentBackup : undefined
            nextDecision = { kind: "chat", model: suggested.decision, fallback: backup }
          } else if (decision.kind !== "manual" && currentBackup && modelIssue(status, currentBackup)) {
            if (decision.kind !== "chat" || modelLabel(decision.model) !== modelLabel(suggested.decision)) {
              nextDecision = { ...decision, fallback: suggested.decision }
            }
          }
          draft = {
            ...draft,
            decision: nextDecision,
            pool: replace ? { mode: "allowlist", models: suggested.workers }
              : draft.pool.mode === "allowlist" && (kept.length === 0 || kept.length < draft.pool.models.length) ? { mode: "allowlist", models: workers } : draft.pool,
          }
          explanations = suggested.reasons
        } catch (error) {
          ctx.ui.toast.show({ title: "AI draft unavailable", message: error instanceof Error ? error.message : String(error), variant: "error" })
        }
      }
      if (section === "apply") {
        if (!await ctx.ui.dialog.confirm({ title: `Activate ${profileTitles[id]} routing profile?`, message: `${decisionLabel} · ${ready} eligible worker models`, label: { confirm: "Apply" } })) continue
        try {
          await rpc("save", { revision, profileID: id, profile: draft })
          ctx.ui.toast.show({ title: "Routing profile applied", message: profileTitles[id], variant: "success" })
          return
        } catch (error) {
          ctx.ui.toast.show({ title: "Routing profile unavailable", message: error instanceof Error ? error.message : String(error), variant: "error" })
        }
      }
    }
  }

  return [
    { id: "omo.native.routing", title: "Momo routing", slash: { name: "momo-routing" } },
    { id: "omo.native.pool", title: "Momo worker pool", slash: { name: "pool" }, start: "pool" as const },
    { id: "omo.native.providers", title: "Momo routing provider access", slash: { name: "momo-routing-providers", aliases: ["providers"] }, start: "providers" as const },
    { id: "omo.native.advisor-pool", title: "Momo advisor models", slash: { name: "advisor-pool" }, start: "advisors" as const },
  ].map(({ start, ...command }) => ({
    ...command, group: "Momo", palette: true, async run() {
      try { await open(start) }
      catch (error) {
        ctx.ui.toast.show({ title: `${command.title} unavailable`, message: error instanceof Error ? error.message : String(error), variant: "error" })
      }
    },
  }))
}
