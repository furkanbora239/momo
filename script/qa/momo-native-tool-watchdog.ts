import type { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type TaskRow = Record<string, unknown>
export async function proveNativeToolWatchdog(input: {
  client: ReturnType<typeof OpenCode.make>
  directory: string
  providerID: string
  modelID: string
  tasks: (rootSessionID: string) => Promise<TaskRow[]>
  denialObserved: () => Promise<boolean>
  deniedFileExists: () => boolean
}): Promise<Record<string, unknown>> {
  const root = await input.client.session.create({ location: { directory: input.directory }, agent: "momo-orchestrator", model: { providerID: input.providerID, id: input.modelID } })
  async function rows(): Promise<TaskRow[]> { return input.tasks(root.id) }
  async function poll(marker: string, predicate: (row: TaskRow) => boolean, timeoutMs: number): Promise<TaskRow> {
    const end = Date.now() + timeoutMs
    let last: TaskRow | undefined
    while (Date.now() < end) {
      last = (await rows()).find((row) => row.prompt === marker)
      if (last && predicate(last)) return last
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Tool proof timed out for ${marker}: ${JSON.stringify(last)}`)
  }
  async function create(marker: string): Promise<void> {
    await input.client.session.prompt({ sessionID: root.id, text: `MOMO_TOOL_CREATE ${marker}` })
    await input.client.session.wait({ sessionID: root.id })
  }
  await create("MOMO_TOOL_PROTECTION")
  await create("MOMO_TOOL_CAP")
  const started = await poll("MOMO_TOOL_PROTECTION", (row) => row.state === "running" && Array.isArray(row.activeTools) && row.activeTools.length > 0, 10_000)
  const tools = started.activeTools as Array<{ startedAt: number; name: string }>
  const oldest = Math.min(...tools.map((tool) => tool.startedAt))
  process.stdout.write("Native tool proof: running actual shell tools past the 60-second silence threshold\n")
  while (Date.now() < oldest + 62_000) await new Promise((resolve) => setTimeout(resolve, 250))
  const protectedTask = await poll("MOMO_TOOL_PROTECTION", (row) => row.state === "running" && Array.isArray(row.activeTools) && row.activeTools.length > 0, 2_000)
  const completed = await poll("MOMO_TOOL_PROTECTION", (row) => row.state === "succeeded" && (row.delivery as TaskRow | undefined)?.status === "delivered", 15_000)
  const capped = await poll("MOMO_TOOL_CAP", (row) => row.state === "interrupted" && String(row.error).includes("active tool timeout"), 50_000)
  const stopDeadline = Date.now() + 5_000
  let active = await input.client.session.active()
  while (active[String(capped.sessionID)] !== undefined && Date.now() < stopDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    active = await input.client.session.active()
  }
  if (active[String(capped.sessionID)] !== undefined) throw new Error("Timed-out native tool session remains active")
  await input.client.session.prompt({ sessionID: root.id, text: `MOMO_TOOL_RESUME ${capped.id}` })
  await input.client.session.wait({ sessionID: root.id })
  const resumed = await poll("MOMO_TOOL_CAP", (row) => row.state === "succeeded" && (row.delivery as TaskRow | undefined)?.status === "delivered", 10_000)
  if (resumed.sessionID !== capped.sessionID || resumed.decisionId !== capped.decisionId || !Array.isArray(resumed.activeTools) || resumed.activeTools.length !== 0) throw new Error("Capped tool did not resume its existing assignment without the expired tool lease")

  await create("MOMO_TOOL_DENIAL")
  await poll("MOMO_TOOL_DENIAL", (row) => row.state === "succeeded", 10_000)
  if (!await input.denialObserved() || input.deniedFileExists()) throw new Error("Native permission denial was not observed or its shell command executed")
  return {
    status: "passed", configuredSilenceTimeoutMs: 60_000, configuredActiveToolTimeoutMs: 70_000,
    protectedAfterSilenceThreshold: { taskID: protectedTask.id, state: protectedTask.state, tools: tools.map((tool) => tool.name) },
    completedProtectedTask: { taskID: completed.id, state: completed.state, delivery: completed.delivery },
    interruptedAtToolCap: { taskID: capped.id, state: capped.state, error: capped.error },
    resumedAfterToolCap: { taskID: resumed.id, sessionID: resumed.sessionID, state: resumed.state, expiredToolLeaseCleared: true },
    nativePermissionHookDeniedShell: true, deniedCommandDidNotWrite: true,
    limits: ["Isolated configured thresholds exercise both watchdog branches. The production defaults remain 180000/3600000 ms; this probe does not wait for the literal 60-minute default cap."],
  }
}
