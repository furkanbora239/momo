
import type { PluginContext } from "../../plugin/types"
import { createRalphLoopEventHandlerImpl } from "./event-handler-impl"
import type { RalphLoopEventHandlerOptions } from "./event-handler-types"

export function createRalphLoopEventHandler(
	ctx: PluginContext,
	options: RalphLoopEventHandlerOptions,
) {
	return createRalphLoopEventHandlerImpl(ctx, options)
}
