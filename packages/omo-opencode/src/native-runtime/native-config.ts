import { loadOmoConfig, mergeOmoConfigRecords, resolveOmoConfigView } from "@oh-my-opencode/omo-config-core"
import { z } from "zod"
import { BackgroundTaskConfigSchema } from "../config/schema/background-task"
import { CatalogConfigSchema } from "../config/schema/catalog"
import { CodegraphConfigSchema } from "../config/schema/codegraph"
import { Context7ConfigSchema } from "../config/schema/context7"
import { ManagerConfigSchema } from "../config/schema/decision-engine"
import { GrepAppConfigSchema } from "../config/schema/grep-app"
import { WebsearchConfigSchema } from "../config/schema/websearch"
import { homeRoot } from "./user-data-paths"

const NativeRuntimeConfigSchema = z.object({
  default_run_agent: z.string().optional(),
  disabled_mcps: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
  manager: ManagerConfigSchema.optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  catalog: CatalogConfigSchema,
  codegraph: CodegraphConfigSchema.optional(),
  context7: Context7ConfigSchema.optional(),
  grep_app: GrepAppConfigSchema.optional(),
  model_fallback: z.boolean().optional(),
  telemetry: z.boolean().optional(),
  websearch: WebsearchConfigSchema.optional(),
})

export type NativeRuntimeConfig = z.infer<typeof NativeRuntimeConfigSchema>

export type NativeRuntimeConfigOptions = {
  homeDirectory?: string
  profile?: string
  environment?: Pick<NodeJS.ProcessEnv, "OMO_PROFILE" | "OCX_PROFILE" | "OPENCODE_CONFIG_DIR">
}

export function loadNativeRuntimeConfig(directory: string, options: NativeRuntimeConfigOptions = {}): NativeRuntimeConfig {
  const env = {
    HOME: options.homeDirectory ?? homeRoot(),
    ...(options.profile === undefined ? {} : { OMO_PROFILE: options.profile }),
    ...(options.environment?.OMO_PROFILE === undefined ? {} : { OMO_PROFILE: options.environment.OMO_PROFILE }),
    ...(options.environment?.OCX_PROFILE === undefined ? {} : { OCX_PROFILE: options.environment.OCX_PROFILE }),
    ...(options.environment?.OPENCODE_CONFIG_DIR === undefined ? {} : { OPENCODE_CONFIG_DIR: options.environment.OPENCODE_CONFIG_DIR }),
  }
  const loaded = loadOmoConfig({ cwd: directory, env })
  const merged = loaded.layers.reduce<Record<string, unknown>>(
    (config, layer) => mergeOmoConfigRecords(config, layer.config),
    {},
  )
  const resolved = resolveOmoConfigView({ config: merged, harness: "opencode", ...(loaded.profile === undefined ? {} : { profile: loaded.profile }) })
  const selected: Record<string, unknown> = {}
  for (const key of [
    "default_run_agent", "disabled_mcps", "disabled_providers", "disabled_tools", "manager", "background_task",
    "catalog", "codegraph", "context7", "grep_app", "model_fallback", "telemetry", "websearch",
  ]) {
    if (key in resolved.config) selected[key] = resolved.config[key]
  }
  const parsed = NativeRuntimeConfigSchema.safeParse(selected)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const key = issue?.path.map(String).join(".") || "<root>"
    throw new Error(`Invalid native OpenCode config at ${key}: ${issue?.message ?? "invalid value"}`)
  }
  return parsed.data
}
