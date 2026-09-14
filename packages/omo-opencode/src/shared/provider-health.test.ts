/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProviderHealthStore } from "./provider-health"

const LONG_COOLDOWN_MS = 6 * 60 * 60 * 1000
const SHORT_COOLDOWN_MS = 2 * 60 * 1000

function createTestStore() {
	const root = mkdtempSync(join(tmpdir(), "provider-health-"))
	const cacheDir = join(root, "oh-my-opencode")
	const store = createProviderHealthStore(() => cacheDir)
	return { root, cacheDir, store }
}

function cleanup(root: string): void {
	if (existsSync(root)) {
		rmSync(root, { recursive: true, force: true })
	}
}

describe("createProviderHealthStore", () => {
	test("marks a provider unavailable and reports it until the cooldown expires", () => {
		const { root, store } = createTestStore()
		try {
			// given
			store.markProviderUnavailable("go-b", { reason: "quota_exceeded" })

			// when / then
			const entry = store.readProviderHealth()["go-b"]
			expect(entry).toBeDefined()
			expect(entry!.reason).toBe("quota_exceeded")
			expect(entry!.unavailableUntil).toBeGreaterThan(Date.now())
			expect(store.isProviderAvailable("go-b")).toBe(false)
			expect(store.isProviderAvailable("go-b", entry!.unavailableUntil - 1)).toBe(false)
			expect(store.isProviderAvailable("go-b", entry!.unavailableUntil)).toBe(true)
		} finally {
			cleanup(root)
		}
	})

	test("uses a long cooldown for quota_exceeded and a short cooldown for transient statuses", () => {
		const { root, store } = createTestStore()
		try {
			// when
			store.markProviderUnavailable("go-b", { reason: "quota_exceeded" })
			store.markProviderUnavailable("neuralwatt", { reason: "transient", statusCode: 503 })

			// then
			const quotaEntry = store.readProviderHealth()["go-b"]!
			const transientEntry = store.readProviderHealth()["neuralwatt"]!
			expect(quotaEntry.unavailableUntil - Date.now()).toBeGreaterThan(LONG_COOLDOWN_MS - 1000)
			expect(transientEntry.unavailableUntil - Date.now()).toBeLessThan(SHORT_COOLDOWN_MS + 1000)
		} finally {
			cleanup(root)
		}
	})

	test("uses a long cooldown for 401/402/403 and missing_api_key, short for 429", () => {
		const { root, store } = createTestStore()
		try {
			// when
			store.markProviderUnavailable("a", { reason: "auth", statusCode: 401 })
			store.markProviderUnavailable("b", { reason: "auth", statusCode: 402 })
			store.markProviderUnavailable("c", { reason: "auth", statusCode: 403 })
			store.markProviderUnavailable("d", { reason: "missing_api_key" })
			store.markProviderUnavailable("e", { reason: "rate limit", statusCode: 429 })

			// then
			const snapshot = store.readProviderHealth()
			for (const id of ["a", "b", "c", "d"]) {
				expect(snapshot[id]!.unavailableUntil - Date.now()).toBeGreaterThan(LONG_COOLDOWN_MS - 1000)
			}
			expect(snapshot.e!.unavailableUntil - Date.now()).toBeLessThan(SHORT_COOLDOWN_MS + 1000)
		} finally {
			cleanup(root)
		}
	})

	test("persists statusCode onto the health entry", () => {
		const { root, store } = createTestStore()
		try {
			// when
			store.markProviderUnavailable("go-b", { reason: "quota_exceeded", statusCode: 402 })

			// then
			expect(store.readProviderHealth()["go-b"]!.statusCode).toBe(402)
		} finally {
			cleanup(root)
		}
	})

	test("treats provider ids case-insensitively", () => {
		const { root, store } = createTestStore()
		try {
			// when
			store.markProviderUnavailable("Go-B", { reason: "quota_exceeded" })

			// then
			expect(store.isProviderAvailable("go-b")).toBe(false)
			expect(store.isProviderAvailable("GO-B")).toBe(false)
			expect(Object.keys(store.readProviderHealth())).toEqual(["go-b"])
			store.clearProviderUnavailable("GO-B")
			expect(store.isProviderAvailable("go-b")).toBe(true)
		} finally {
			cleanup(root)
		}
	})

	test("reports an unknown provider as available", () => {
		const { root, store } = createTestStore()
		try {
			// when / then
			expect(store.isProviderAvailable("never-seen")).toBe(true)
			expect(store.readProviderHealth()).toEqual({})
		} finally {
			cleanup(root)
		}
	})

	test("clearing an unavailable provider restores availability", () => {
		const { root, store } = createTestStore()
		try {
			// given
			store.markProviderUnavailable("go-b", { reason: "quota_exceeded" })
			expect(store.isProviderAvailable("go-b")).toBe(false)

			// when
			store.clearProviderUnavailable("go-b")

			// then
			expect(store.isProviderAvailable("go-b")).toBe(true)
			expect(store.readProviderHealth()["go-b"]).toBeUndefined()
		} finally {
			cleanup(root)
		}
	})

	test("survives a corrupt health file by falling back to an empty snapshot", () => {
		const { root, cacheDir, store } = createTestStore()
		try {
			// given - a non-JSON health file is already on disk
			mkdirSync(cacheDir, { recursive: true })
			writeFileSync(join(cacheDir, "provider-health.json"), "not-json", "utf-8")

			// when / then
			expect(store.readProviderHealth()).toEqual({})
			expect(store.isProviderAvailable("go-b")).toBe(true)
		} finally {
			cleanup(root)
		}
	})
})
