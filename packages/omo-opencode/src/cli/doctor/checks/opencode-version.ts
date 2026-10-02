import { isPlainRecord } from "@oh-my-opencode/utils"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeConfigDir, log, parseJsonc } from "../../../shared"
import {
  defaultOpenCodeVersionProbe,
  isOpenCodeV2,
  type OpenCodeVersionProbe,
  type OpenCodeVersionProbeResult,
} from "../../../shared/opencode-version-probe"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

export interface OpenCodeVersionCheckDeps {
  readonly configDir?: string
  readonly versionProbe?: OpenCodeVersionProbe
}

interface OpenCodePluginConfigShape {
  plugin?: unknown
  plugins?: unknown
}

type PluginKeyState = {
  readonly configPath: string | null
  readonly hasLegacyPluginKey: boolean
  readonly hasV2PluginsKey: boolean
}

function registrationMode(major: number | null): string {
  return isOpenCodeV2(major) ? "setup() (V2)" : "server() (V1)"
}

function versionLabel(major: number | null): string {
  return isOpenCodeV2(major) ? "V2" : major === null ? "unknown" : "V1"
}

function readPluginConfig(configDir: string): PluginKeyState {
  for (const fileName of ["opencode.jsonc", "opencode.json"] as const) {
    const configPath = join(configDir, fileName)
    if (!existsSync(configPath)) continue
    try {
      const parsed = parseJsonc<OpenCodePluginConfigShape>(readFileSync(configPath, "utf-8"))
      if (!isPlainRecord(parsed)) {
        return { configPath, hasLegacyPluginKey: false, hasV2PluginsKey: false }
      }
      return {
        configPath,
        hasLegacyPluginKey: Array.isArray(parsed["plugin"]),
        hasV2PluginsKey: Array.isArray(parsed["plugins"]),
      }
    } catch (error) {
      log("[opencode-version] Failed to inspect opencode plugin config", {
        configPath,
        error: error instanceof Error ? error.message : String(error),
      })
      return { configPath, hasLegacyPluginKey: false, hasV2PluginsKey: false }
    }
  }
  return { configPath: null, hasLegacyPluginKey: false, hasV2PluginsKey: false }
}

function buildIssues(probe: OpenCodeVersionProbeResult, pluginKeys: PluginKeyState): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  if (!isOpenCodeV2(probe.major)) return issues
  if (!pluginKeys.hasLegacyPluginKey || pluginKeys.configPath === null) return issues
  issues.push({
    title: "opencode config still uses the V1 plugin key",
    description:
      `OpenCode ${probe.version ?? ""} (V2) reads plugin registrations from "plugins", but `
      + `${pluginKeys.configPath} still registers plugins under "plugin". `
      + "momo self-heals this on load; until then V2 may not load momo.",
    fix:
      `Rename "plugin" to "plugins" in ${pluginKeys.configPath} `
      + '(string entries stay strings; [path, options] tuples become {"package": path, "options": {...}}), '
      + `or rerun \`npx ${PACKAGE_NAME} install\`.`,
    affects: ["plugin loading"],
    severity: "warning",
  })
  return issues
}

export async function checkOpenCodeVersion(deps: OpenCodeVersionCheckDeps = {}): Promise<CheckResult> {
  const name = CHECK_NAMES[CHECK_IDS.OPENCODE_VERSION]
  const probe = (deps.versionProbe ?? defaultOpenCodeVersionProbe)()
  const configDir = deps.configDir ?? getOpenCodeConfigDir({ binary: "opencode", version: null })
  const pluginKeys = readPluginConfig(configDir)
  const issues = buildIssues(probe, pluginKeys)
  const status = issues.length > 0 ? "warn" : probe.available ? "pass" : "skip"

  return {
    name,
    status,
    message: !probe.available
      ? "OpenCode version not detected"
      : issues.length > 0
        ? "OpenCode V2 detected with a V1 plugin registration"
        : `OpenCode ${probe.version} (${versionLabel(probe.major)})`,
    details: [
      `opencode: ${probe.version ?? "not detected"} (${versionLabel(probe.major)})`,
      `plugin registration: ${registrationMode(probe.major)}`,
      ...(pluginKeys.configPath === null ? [] : [
        `config: ${pluginKeys.configPath}`,
        `plugin key: ${pluginKeys.hasLegacyPluginKey ? "plugin (V1)" : "absent"}`,
        `plugins key: ${pluginKeys.hasV2PluginsKey ? "plugins (V2)" : "absent"}`,
      ]),
    ],
    issues,
  }
}
