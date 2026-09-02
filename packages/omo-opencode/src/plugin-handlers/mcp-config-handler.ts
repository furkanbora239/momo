import { existsSync } from "node:fs"
import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import * as runtimeExecutableModule from "../mcp/runtime-executable";
import type { PluginComponents } from "./plugin-components-loader";
import { log } from "../shared";

type McpEntry = Record<string, unknown>;

function isDisabledMcpEntry(value: unknown): value is McpEntry & { enabled: false } {
  return typeof value === "object" && value !== null && (value as McpEntry).enabled === false;
}

function looksLikeExecutablePath(executable: string): boolean {
  return executable.includes("/") || executable.includes("\\") || /^[a-zA-Z]:/.test(executable);
}

function isUnresolvableLocalCommand(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const record = entry as McpEntry;
  if (record.type !== "local") return false;
  const command = record.command;
  const executable = Array.isArray(command) ? command[0] : command;
  if (typeof executable !== "string" || executable.length === 0) return false;
  if (looksLikeExecutablePath(executable)) return !existsSync(executable);
  return !runtimeExecutableModule.resolveRuntimeExecutable(executable).available;
}

function captureUserDisabledMcps(
  userMcp: Record<string, unknown> | undefined
): Set<string> {
  const disabled = new Set<string>();
  if (!userMcp) return disabled;

  for (const [name, value] of Object.entries(userMcp)) {
    if (isDisabledMcpEntry(value)) {
      disabled.add(name);
    }
  }

  return disabled;
}

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  ctx: { directory: string };
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledMcps = params.pluginConfig.disabled_mcps ?? [];
  const userMcp = params.config.mcp as Record<string, unknown> | undefined;
  const userDisabledMcps = captureUserDisabledMcps(userMcp);

  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadMcpConfigs(disabledMcps)
    : { servers: {} };

  if (userMcp) {
    for (const name of Object.keys(userMcp)) {
      if (name in mcpResult.servers) {
        log(`warning: MCP server "${name}" from user config overrides Claude Code .mcp.json`);
      }
    }
  }

  const builtinMcps = createBuiltinMcps(disabledMcps, params.pluginConfig, { cwd: params.ctx.directory });

  const claudeCodeServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(mcpResult.servers)) {
    if (name in builtinMcps && isUnresolvableLocalCommand(server)) {
      log(`warning: MCP server "${name}" from Claude Code .mcp.json has an unresolvable command; keeping the built-in "${name}" server`);
      continue;
    }
    claudeCodeServers[name] = server;
  }

  const merged = {
    ...builtinMcps,
    ...claudeCodeServers,
    ...(userMcp ?? {}),
    ...params.pluginComponents.mcpServers,
  } as Record<string, McpEntry>;

  for (const name of userDisabledMcps) {
    if (merged[name]) {
      merged[name] = { ...merged[name], enabled: false };
    }
  }

  const disabledSet = new Set(disabledMcps);
  for (const name of disabledSet) {
    delete merged[name];
  }

  params.config.mcp = merged;
}
