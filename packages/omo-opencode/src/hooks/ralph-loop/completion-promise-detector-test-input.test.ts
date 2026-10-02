/// <reference types="bun-types" />

import type { PluginContext } from "../../plugin/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

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

	const messagesFunction = unsafeTestValue<PluginContext["client"]["session"]["messages"]>(async () => ({ data: messages }))
	pluginInput.client.session.messages = messagesFunction

	return pluginInput
}
