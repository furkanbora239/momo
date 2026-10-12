import { resolveRunModel } from "../run/model-resolver"
import { executeOnCompleteHook } from "../run/on-complete-hook"
import { connectNativeService } from "./service"
import { waitForNativeCompletion } from "./completion"
import { readRootTasks } from "./tasks"
import { resolveNativeAgent } from "./agent"
import { isSupportedNativeRuntimeVersion } from "../../native-runtime/v2-service-client"
import type { NativeRunOptions, NativeRunResult } from "./types"

export type RunOptions = NativeRunOptions
export type RunResult = NativeRunResult

export async function run(options: NativeRunOptions): Promise<number> {
  if (options.port !== undefined && options.attach !== undefined) throw new Error("--port and --attach are mutually exclusive")
  const start = Date.now()
  const directory = options.directory ?? process.cwd()
  const json = options.json ?? false
  const requestedAgent = options.agent ?? "momo-orchestrator"
  const model = resolveRunModel(options.model)
  const controller = new AbortController()
  let sessionID = ""
  let client: Awaited<ReturnType<typeof connectNativeService>> | undefined
  const abort = () => {
    controller.abort()
    if (sessionID) void client?.session.interrupt({ sessionID }).catch(() => undefined)
  }
  process.once("SIGINT", abort)
  try {
    client = await connectNativeService(options)
    const info = await client.server.info()
    if (!isSupportedNativeRuntimeVersion(info.version)) throw new Error(`OpenCode v2 2.0.24+ is required; found ${info.version}`)
    const agent = await resolveNativeAgent(client, requestedAgent, directory)
    if (options.sessionId !== undefined) {
      const session = await client.session.get({ sessionID: options.sessionId })
      sessionID = session.id
      if (agent !== session.agent) await client.session.switchAgent({ sessionID, agent })
      if (model !== undefined) await client.session.switchModel({ sessionID, model: { providerID: model.providerID, id: model.modelID } })
    } else {
      const session = await client.session.create({
        location: { directory },
        title: "momo run",
        agent,
        ...(model !== undefined ? { model: { providerID: model.providerID, id: model.modelID } } : {}),
      })
      sessionID = session.id
    }
    await readRootTasks(client, directory, sessionID)
    if (!json) process.stderr.write(`Session: ${sessionID}\n`)
    const completion = waitForNativeCompletion({
      client,
      directory,
      sessionID,
      signal: controller.signal,
      json,
      verbose: options.verbose ?? false,
      timestamp: options.timestamp ?? true,
    })
    const prompt = client.session.prompt({ sessionID, text: options.message })
    const [, completed] = await Promise.all([prompt, completion])
    if (completed === 130) return 130
    const result: NativeRunResult = {
      sessionId: sessionID,
      success: completed.success && completed.tasks.every((task) => task.state === "succeeded"),
      durationMs: Date.now() - start,
      messageCount: completed.messageCount,
      summary: completed.summary || "Run completed",
    }
    if (options.onComplete !== undefined) await executeOnCompleteHook({
      command: options.onComplete,
      sessionId: sessionID,
      exitCode: result.success ? 0 : 1,
      durationMs: result.durationMs,
      messageCount: result.messageCount,
    })
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`)
    else process.stderr.write(`\n${result.success ? "Run completed" : "Run finished with failures"} (${result.durationMs}ms)\n`)
    return result.success ? 0 : 1
  } catch (error) {
    if (json) process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    else process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    controller.abort()
    process.removeListener("SIGINT", abort)
  }
}
