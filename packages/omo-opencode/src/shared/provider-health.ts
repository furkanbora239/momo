import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import * as dataPath from "./data-path"
import { log } from "./logger"

const PROVIDER_HEALTH_FILE = "provider-health.json"

const LONG_COOLDOWN_MS = 6 * 60 * 60 * 1000
const SHORT_COOLDOWN_MS = 2 * 60 * 1000

export interface ProviderHealthEntry {
	reason: string
	statusCode?: number
	unavailableUntil: number
}

export type ProviderHealthSnapshot = Record<string, ProviderHealthEntry>

export type ProviderUnavailableInfo = {
	reason: string
	statusCode?: number
}

function normalizeProviderID(providerID: string): string {
	return providerID.trim().toLowerCase()
}

function resolveCooldownMs(info: ProviderUnavailableInfo): number {
	const status = info.statusCode
	if (status === 401 || status === 402 || status === 403) {
		return LONG_COOLDOWN_MS
	}
	if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
		return SHORT_COOLDOWN_MS
	}
	const reason = info.reason.toLowerCase()
	if (reason === "quota_exceeded" || reason === "missing_api_key") {
		return LONG_COOLDOWN_MS
	}
	return SHORT_COOLDOWN_MS
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function createProviderHealthStore(
	getCacheDir: () => string = dataPath.getOmoOpenCodeCacheDir,
) {
	const healthFilePath = () => join(getCacheDir(), PROVIDER_HEALTH_FILE)

	function readProviderHealth(): ProviderHealthSnapshot {
		try {
			if (!existsSync(healthFilePath())) {
				return {}
			}
			const parsed = JSON.parse(readFileSync(healthFilePath(), "utf-8")) as unknown
			if (!isPlainRecord(parsed)) {
				return {}
			}
			return parsed as ProviderHealthSnapshot
		} catch (error) {
			log("[provider-health] Error reading provider health", { error: String(error) })
			return {}
		}
	}

	function writeProviderHealth(snapshot: ProviderHealthSnapshot): void {
		try {
			const cacheDir = getCacheDir()
			if (!existsSync(cacheDir)) {
				mkdirSync(cacheDir, { recursive: true })
			}
			writeFileSync(healthFilePath(), JSON.stringify(snapshot, null, 2))
		} catch (error) {
			log("[provider-health] Error writing provider health", { error: String(error) })
		}
	}

	function markProviderUnavailable(providerID: string, info: ProviderUnavailableInfo): void {
		if (!providerID) return
		const key = normalizeProviderID(providerID)
		const snapshot = readProviderHealth()
		const entry: ProviderHealthEntry = {
			reason: info.reason,
			unavailableUntil: Date.now() + resolveCooldownMs(info),
		}
		if (info.statusCode !== undefined) {
			entry.statusCode = info.statusCode
		}
		snapshot[key] = entry
		writeProviderHealth(snapshot)
		log("[provider-health] Marked provider unavailable", {
			providerID: key,
			reason: info.reason,
			statusCode: info.statusCode,
			unavailableUntil: entry.unavailableUntil,
		})
	}

	function clearProviderUnavailable(providerID: string): void {
		if (!providerID) return
		const key = normalizeProviderID(providerID)
		const snapshot = readProviderHealth()
		if (!(key in snapshot)) return
		delete snapshot[key]
		writeProviderHealth(snapshot)
	}

	function isProviderAvailable(providerID: string, now: number = Date.now()): boolean {
		if (!providerID) return true
		const entry = readProviderHealth()[normalizeProviderID(providerID)]
		if (!entry) return true
		return now >= entry.unavailableUntil
	}

	return {
		markProviderUnavailable,
		clearProviderUnavailable,
		readProviderHealth,
		isProviderAvailable,
	}
}

const defaultProviderHealthStore = createProviderHealthStore()

export const {
	markProviderUnavailable,
	clearProviderUnavailable,
	readProviderHealth,
	isProviderAvailable,
} = defaultProviderHealthStore
