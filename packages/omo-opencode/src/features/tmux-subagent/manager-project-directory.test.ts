/// <reference path="../../../../../bun-test.d.ts" />
import type { PluginContext } from "../../plugin/types"
import { describe, expect, it, mock } from "bun:test"


import type { TmuxConfig } from "../../config/schema"
import { TmuxSessionManager, type TmuxUtilDeps } from "./manager"

const tmuxConfig = {
	enabled: true,
	isolation: "inline",
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 80,
	agent_pane_min_width: 40,
} satisfies TmuxConfig

const tmuxDeps: TmuxUtilDeps = {
	isInsideTmux: () => true,
	getCurrentPaneId: () => "%0",
	queryWindowState: mock(async () => null),
}

function createPluginInput(directory: string): PluginContext {
	let shell: PluginContext["$"]
	shell = Object.assign(
		() => {
			throw new Error("shell should not be used in this test")
		},
		{
			braces: (): string[] => [],
			escape: (input: string): string => input,
			env: (): PluginContext["$"] => shell,
			cwd: (): PluginContext["$"] => shell,
			nothrow: (): PluginContext["$"] => shell,
			throws: (): PluginContext["$"] => shell,
		},
	)

	return {
		client: Object.assign({} as PluginContext["client"], {
			session: {
				status: mock(async () => ({ data: {} })),
				messages: mock(async () => ({ data: [] })),
			},
		}),
		project: {} as PluginContext["project"],
		directory,
		worktree: process.cwd(),
		serverUrl: new URL("http://localhost:4096"),
		$: shell,
	}
}

describe("TmuxSessionManager projectDirectory", () => {
	it("#given empty ctx.directory #when manager is constructed #then it falls back to process.cwd()", () => {
		// given
		const ctx = createPluginInput("")

		// when
		const manager = new TmuxSessionManager(ctx, tmuxConfig, tmuxDeps)

		// then
		expect(Reflect.get(manager, "projectDirectory")).toBe(process.cwd())
	})
})
