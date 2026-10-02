import type { PluginContext } from "../../plugin/types"
/// <reference types="bun-types" />


export type SessionMessage = {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

export function createPluginInput(messages: SessionMessage[]): PluginContext {
	const pluginInput = {
		client: { session: {} } as PluginContext["client"],
		project: {} as PluginContext["project"],
		directory: "/tmp",
		worktree: "/tmp",
		serverUrl: new URL("http://localhost"),
		$: {} as PluginContext["$"],
	} as PluginContext

	pluginInput.client.session.messages =
		(async () => ({ data: messages })) as unknown as PluginContext["client"]["session"]["messages"]

	return pluginInput
}
