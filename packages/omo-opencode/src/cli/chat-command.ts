import { autocomplete, isCancel } from "@clack/prompts"
import type { Command } from "commander"
import { spawn } from "node:child_process"
import { resolve } from "node:path"

interface ChatOptions {
  readonly model?: string
  readonly server?: string
  readonly prompt?: string
}

interface ChatDependencies {
  readonly interactive: boolean
  readonly chooseModel: (models: readonly string[]) => Promise<string | undefined>
  readonly capture: (args: readonly string[], directory: string) => Promise<string>
  readonly open: (args: readonly string[], directory: string) => Promise<number>
}

function runOpenCode(args: readonly string[], directory: string, interactive: boolean) {
  return new Promise<{ output: string; code: number }>((resolve, reject) => {
    const child = spawn(process.env.MOMO_NATIVE_OPENCODE_BIN ?? "opencode", args, {
      cwd: directory,
      stdio: interactive ? "inherit" : ["ignore", "pipe", "inherit"],
    })
    let output = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { output += chunk })
    child.once("error", reject)
    child.once("close", (code) => resolve({ output, code: code ?? 1 }))
  })
}

const defaults: ChatDependencies = {
  get interactive() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY)
  },
  async chooseModel(models) {
    const choice = await autocomplete({
      message: "Choose the model for this chat",
      maxItems: 8,
      options: models.map((model) => ({ value: model, label: model })),
    })
    return isCancel(choice) ? undefined : choice
  },
  async capture(args, directory) {
    const { output, code } = await runOpenCode(args, directory, false)
    if (code !== 0) throw new Error(`OpenCode ${args[0]} exited with status ${code}`)
    return output
  },
  async open(args, directory) {
    return (await runOpenCode(args, directory, true)).code
  },
}

export async function openChat(
  directory: string,
  options: ChatOptions,
  deps: ChatDependencies = defaults,
): Promise<number> {
  if (!deps.interactive) throw new Error("Opening a chat requires an interactive terminal")

  const location = { directory: resolve(directory) }
  const serverArgs = options.server === undefined ? [] : ["--server", options.server]
  const output = await deps.capture(["models", ...serverArgs], location.directory)
  const models = [...new Set(output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/\S+$/.test(line)))]
  if (models.length === 0) throw new Error("OpenCode has no available chat models in this project")

  const selection = options.model ?? await deps.chooseModel(models)
  if (selection === undefined) return 0
  if (!models.includes(selection)) throw new Error(`Model unavailable in this project: ${selection}`)
  const divider = selection.indexOf("/")
  const model = { providerID: selection.slice(0, divider), id: selection.slice(divider + 1) }

  // The full OpenCode TUI takes a session ID, while --model is a run/mini option.
  const body = await deps.capture([
    "api", "session.create", ...serverArgs, "--data", JSON.stringify({ location, model }),
  ], location.directory)
  const result: { data?: { id?: unknown; model?: { providerID?: unknown; id?: unknown } } } | null = JSON.parse(body)
  const session = result?.data
  if (typeof session?.id !== "string" || session.id.length === 0) {
    throw new Error("OpenCode did not return the new session ID")
  }
  if (session.model?.providerID !== model.providerID || session.model.id !== model.id) {
    throw new Error(`OpenCode did not save the selected model: ${selection}`)
  }

  const promptArgs = options.prompt === undefined ? [] : ["--prompt", options.prompt]
  return deps.open(["--session", session.id, ...serverArgs, ...promptArgs], location.directory)
}

export function configureChatCommand(program: Command): void {
  program
    .command("chat [directory]")
    .description("Choose a model before opening a new OpenCode chat")
    .option("-m, --model <provider/model>", "Select an available model without opening the picker")
    .option("--server <url>", "Use an existing OpenCode server")
    .option("--prompt <text>", "Send a prompt after opening the chat")
    .action(async (directory: string | undefined, options: ChatOptions) => {
      try {
        process.exitCode = await openChat(directory ?? process.cwd(), options)
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      }
    })
}
