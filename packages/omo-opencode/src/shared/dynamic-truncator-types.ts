import type { PluginContext } from "../plugin/types"
;

export type ContextWindowUsage = {
	usedTokens: number;
	remainingTokens: number;
	usagePercentage: number;
}

export type ContextWindowUsageClient = Pick<PluginContext["client"], "session">

export interface TruncationResult {
	result: string;
	truncated: boolean;
	removedCount?: number;
}

export interface TruncationOptions {
	targetMaxTokens?: number;
	preserveHeaderLines?: number;
	contextWindowLimit?: number;
}
