import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { _resetForTesting, registerAgentName } from "../../features/claude-code-session-state"
import { clearCommandLoaderCache } from "../../features/claude-code-command-loader"
import { loadBuiltinCommands } from "../../features/builtin-commands/commands"
import { createChatMessageHandler } from "../../plugin/chat-message"
import { createCommandExecuteBeforeHandler } from "../../plugin/command-execute-before"
import { createStartWorkHook } from "../start-work"
import { executeSlashCommand } from "./executor"
import { createAutoSlashCommandHook } from "./hook"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
} from "./types"

const ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_PLUGINS_HOME",
  "CLAUDE_SETTINGS_PATH",
  "OPENCODE_CONFIG_DIR",
] as const

type EnvKey = (typeof ENV_KEYS)[number]
type EnvSnapshot = Record<EnvKey, string | undefined>
type TextPart = { readonly text?: string }

const FIXED_TIMESTAMP = "2026-07-16T12:34:56.789Z"

function joinTextParts(parts: readonly TextPart[]): string {
  return parts.map((part) => part.text ?? "").join("\n")
}

function createComposedHooks(directory: string) {
  return {
    autoSlashCommand: createAutoSlashCommandHook({ skills: [], directory }),
    startWork: createStartWorkHook(unsafeTestValue<Parameters<typeof createStartWorkHook>[0]>({
      directory,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    })),
  }
}

function createComposedChatMessageHandler(directory: string) {
  const hooks = createComposedHooks(directory)
  return createChatMessageHandler({
    ctx: unsafeTestValue<Parameters<typeof createChatMessageHandler>[0]["ctx"]>({
      directory,
      client: {
        tui: {
          showToast: async () => {},
        },
      },
    }),
    pluginConfig: unsafeTestValue<Parameters<typeof createChatMessageHandler>[0]["pluginConfig"]>({}),
    firstMessageVariantGate: {
      shouldOverride: () => false,
      markApplied: () => {},
    },
    hooks: unsafeTestValue<Parameters<typeof createChatMessageHandler>[0]["hooks"]>(hooks),
  })
}

function createComposedCommandExecuteBeforeHandler(directory: string) {
  const hooks = createComposedHooks(directory)
  return createCommandExecuteBeforeHandler({
    directory,
    hooks: unsafeTestValue<Parameters<typeof createCommandExecuteBeforeHandler>[0]["hooks"]>(hooks),
  })
}

function createChatInput(sessionID: string, messageID: string): AutoSlashCommandHookInput {
  return {
    sessionID,
    messageID,
    agent: "test-agent",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  }
}

function createChatOutput(text: string): AutoSlashCommandHookOutput {
  return {
    message: {},
    parts: [{ type: "text", text }],
  }
}

function writePluginFixture(baseDir: string): void {
  const claudeConfigDir = join(baseDir, "claude-config")
  const pluginsHome = join(claudeConfigDir, "plugins")
  const settingsPath = join(claudeConfigDir, "settings.json")
  const opencodeConfigDir = join(baseDir, "opencode-config")
  const pluginInstallPath = join(baseDir, "installed-plugins", "daplug")
  const pluginKey = "daplug@1.0.0"

  mkdirSync(join(pluginInstallPath, ".claude-plugin"), { recursive: true })
  mkdirSync(join(pluginInstallPath, "commands"), { recursive: true })

  writeFileSync(
    join(pluginInstallPath, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "daplug", version: "1.0.0" }, null, 2),
  )
  writeFileSync(
    join(pluginInstallPath, "commands", "run-prompt.md"),
    `---
description: Run prompt from daplug
---
Execute daplug prompt flow.
`,
  )
  writeFileSync(
    join(pluginInstallPath, "commands", "templated.md"),
    `---
description: Templated prompt from daplug
---
Echo $ARGUMENTS and \${user_message}.
Session $SESSION_ID at $TIMESTAMP. Keep @missing-reference unchanged.
`,
  )
  writeFileSync(
    join(pluginInstallPath, "commands", "special-args.md"),
    `---
description: Special argument prompt from daplug
---
Echo $ARGUMENTS.
`,
  )
  const userCommandsDir = join(claudeConfigDir, "commands")
  mkdirSync(userCommandsDir, { recursive: true })
  writeFileSync(
    join(userCommandsDir, "plain.md"),
    `---
description: Plain user prompt
---
Execute the plain prompt.
`,
  )

  mkdirSync(pluginsHome, { recursive: true })
  writeFileSync(
    join(pluginsHome, "installed_plugins.json"),
    JSON.stringify(
      {
        version: 2,
        plugins: {
          [pluginKey]: [
            {
              scope: "user",
              installPath: pluginInstallPath,
              version: "1.0.0",
              installedAt: "2026-01-01T00:00:00.000Z",
              lastUpdated: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      },
      null,
      2,
    ),
  )

  mkdirSync(claudeConfigDir, { recursive: true })
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        enabledPlugins: {
          [pluginKey]: true,
        },
      },
      null,
      2,
    ),
  )
  mkdirSync(opencodeConfigDir, { recursive: true })

  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
  process.env.CLAUDE_PLUGINS_HOME = pluginsHome
  process.env.CLAUDE_SETTINGS_PATH = settingsPath
  process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir
}

describe("auto-slash command executor plugin dispatch", () => {
  let tempDir = ""
  let envSnapshot: EnvSnapshot

  beforeEach(() => {
    clearCommandLoaderCache()
    tempDir = mkdtempSync(join(tmpdir(), "omo-executor-plugin-test-"))
    envSnapshot = {
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      CLAUDE_PLUGINS_HOME: process.env.CLAUDE_PLUGINS_HOME,
      CLAUDE_SETTINGS_PATH: process.env.CLAUDE_SETTINGS_PATH,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
    writePluginFixture(tempDir)
  })

  afterEach(() => {
    setSystemTime()
    clearCommandLoaderCache()
    for (const key of ENV_KEYS) {
      const previousValue = envSnapshot[key]
      if (previousValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("resolves marketplace plugin commands when plugin loading is enabled", async () => {
    const result = await executeSlashCommand(
      {
        command: "daplug:run-prompt",
        args: "ship it",
        raw: "/daplug:run-prompt ship it",
      },
      {
        skills: [],
        pluginsEnabled: true,
      },
    )

    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("**Scope**: plugin")
  })

  it("excludes marketplace commands when plugins are disabled via config toggle", async () => {
    const result = await executeSlashCommand(
      {
        command: "daplug:run-prompt",
        args: "",
        raw: "/daplug:run-prompt",
      },
      {
        skills: [],
        pluginsEnabled: false,
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Command "/daplug:run-prompt" not found. Use the skill tool to list available skills and commands.',
    )
  })

  it("returns standard not-found for unknown namespaced commands", async () => {
    const result = await executeSlashCommand(
      {
        command: "daplug:missing",
        args: "",
        raw: "/daplug:missing",
      },
      {
        skills: [],
        pluginsEnabled: true,
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Command "/daplug:missing" not found. Use the skill tool to list available skills and commands.',
    )
    expect(result.error).not.toContain("Marketplace plugin commands")
  })

  it("replaces $ARGUMENTS placeholders in plugin command templates", async () => {
    const result = await executeSlashCommand(
      {
        command: "daplug:templated",
        args: "ship it",
        raw: "/daplug:templated ship it",
      },
      {
        skills: [],
        pluginsEnabled: true,
        sessionID: "ses_templated_args",
      },
    )

    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("Echo ship it and ship it.")
    expect(result.replacementText).not.toContain("$ARGUMENTS")
    expect(result.replacementText).not.toContain("${user_message}")
  })

  it("retains the user request section for command templates without argument placeholders", async () => {
    const result = await executeSlashCommand(
      {
        command: "plain",
        args: "ship it",
        raw: "/plain ship it",
      },
      {
        skills: [],
        pluginsEnabled: true,
        directory: tempDir,
      },
    )

    expect(result.success).toBe(true)
  })

  it("preserves special arguments as data when a command template consumes them", async () => {
    const injectionMarker = join(tempDir, "should-not-exist")
    const args = `ship @secret.txt $(touch ${injectionMarker}) $HOME`

    const result = await executeSlashCommand(
      {
        command: "daplug:special-args",
        args,
        raw: `/daplug:special-args ${args}`,
      },
      {
        skills: [],
        pluginsEnabled: true,
      },
    )

    expect(result.success).toBe(true)
    expect(result.replacementText).toContain(`Echo ${args}.`)
    expect(existsSync(injectionMarker)).toBe(false)
  })

  it("substitutes runtime placeholders once without rewriting user arguments or unresolved file references", async () => {
    // given
    const timestamp = "2026-07-16T12:34:56.789Z"
    const sessionID = "ses_runtime_123"
    const args = "ship $SESSION_ID $TIMESTAMP $& safely"
    setSystemTime(new Date(timestamp))

    // when
    const result = await executeSlashCommand(
      {
        command: "daplug:templated",
        args,
        raw: `/daplug:templated ${args}`,
      },
      {
        skills: [],
        pluginsEnabled: true,
        sessionID,
      },
    )

    // then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain(`Echo ${args} and ${args}.`)
    expect(result.replacementText).toContain(`Session ${sessionID} at ${timestamp}.`)
    expect(result.replacementText).toContain("Keep @missing-reference unchanged.")
  })

  it("rejects a session-bound builtin command when the session ID is missing", async () => {
    // given
    const parsed = {
      command: "handoff",
      args: "",
      raw: "/handoff",
    }

    // when
    const result = await executeSlashCommand(parsed, { skills: [] })

    // then
    expect(result).toEqual({
      success: false,
      error: 'Failed to load command "/handoff": Command template requires a session ID',
    })
  })

  it("substitutes the exact session ID in handoff session_read instructions", async () => {
    // given
    const sessionID = "ses_handoff_exact"

    // when
    const result = await executeSlashCommand(
      {
        command: "handoff",
        args: "",
        raw: "/handoff",
      },
      {
        skills: [],
        sessionID,
      },
    )

    // then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain(`session_read({ session_id: "${sessionID}" })`)
    expect(result.replacementText).not.toContain("$SESSION_ID")
    expect(result.replacementText).not.toContain("$TIMESTAMP")
  })
})
