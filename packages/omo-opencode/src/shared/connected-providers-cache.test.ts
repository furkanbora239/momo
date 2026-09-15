/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type ConnectedProvidersCacheModule = typeof import("./connected-providers-cache")

async function importFreshConnectedProvidersCacheModule(): Promise<ConnectedProvidersCacheModule> {
  return await import(
    new URL(`./connected-providers-cache.ts?real-connected-providers-cache-test=${Date.now()}-${Math.random()}`, import.meta.url).href
  )
}

function createTestCacheContext(
  createConnectedProvidersCacheStore: ConnectedProvidersCacheModule["createConnectedProvidersCacheStore"],
) {
	const fakeUserCacheRoot = mkdtempSync(join(tmpdir(), "connected-providers-user-cache-"))
	const testCacheDir = join(fakeUserCacheRoot, "oh-my-opencode")
	const testCacheStore = createConnectedProvidersCacheStore(() => testCacheDir)

	return {
		fakeUserCacheRoot,
		testCacheDir,
		testCacheStore,
	}
}

function cleanupTestCacheContext(fakeUserCacheRoot: string): void {
	if (existsSync(fakeUserCacheRoot)) {
		rmSync(fakeUserCacheRoot, { recursive: true, force: true })
	}
}

describe("updateConnectedProvidersCache", () => {
	test("extracts models from provider.list().all response", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai", "anthropic"],
							all: [
								{
									id: "openai",
									name: "OpenAI",
									env: [],
									models: {
										"gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5" },
										"gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
									},
								},
								{
									id: "anthropic",
									name: "Anthropic",
									env: [],
									models: {
										"claude-opus-4-7": { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
										"claude-sonnet-4-6": { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
									},
								},
							],
						},
					}),
				},
			}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.connected).toEqual(["openai", "anthropic"])
			expect(cache!.models).toEqual({
				openai: [
					{ id: "gpt-5.5", name: "GPT-5.5" },
					{ id: "gpt-5.4", name: "GPT-5.4" },
				],
				anthropic: [
					{ id: "claude-opus-4-7", name: "Claude Opus 4.7" },
					{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
				],
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("evicts providers absent from connected and all", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given - a previous complete provider snapshot includes two connected providers
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google", "anthropic"],
							all: [
								{
									id: "google",
									models: {
										"gemini-3.1-pro": { id: "gemini-3.1-pro" },
									},
								},
								{
									id: "anthropic",
									models: {
										"claude-opus-4-7": { id: "claude-opus-4-7" },
									},
								},
							],
						},
					}),
				},
			})

			//#when - a non-empty refresh reports only one connected provider and drops
			// the other from both `connected` and `all` (as a disabled provider is dropped)
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google"],
							all: [
								{
									id: "google",
									models: {
										"gemini-3.1-pro": { id: "gemini-3.1-pro" },
									},
								},
							],
						},
					}),
				},
			})

			//#then - the absent provider is evicted, not resurrected
			expect(testCacheStore.readConnectedProvidersCache()).toEqual(["google"])
			expect(testCacheStore.readProviderModelsCache()).toMatchObject({
				connected: ["google"],
				models: {
					google: [{ id: "gemini-3.1-pro" }],
				},
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("preserves the previous snapshot when a refresh returns a completely empty list", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given - a previous complete provider snapshot
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google", "anthropic"],
							all: [
								{
									id: "google",
									models: {
										"gemini-3.1-pro": { id: "gemini-3.1-pro" },
									},
								},
								{
									id: "anthropic",
									models: {
										"claude-opus-4-7": { id: "claude-opus-4-7" },
									},
								},
							],
						},
					}),
				},
			})

			//#when - a transient cold-start refresh reports nothing at all
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: [],
							all: [],
						},
					}),
				},
			})

			//#then - the empty fetch does not poison the last-good snapshot
			expect(testCacheStore.readConnectedProvidersCache()).toEqual(["google", "anthropic"])
			expect(testCacheStore.readProviderModelsCache()).toMatchObject({
				connected: ["google", "anthropic"],
				models: {
					google: [{ id: "gemini-3.1-pro" }],
					anthropic: [{ id: "claude-opus-4-7" }],
				},
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("removes stale providers when a complete refresh confirms they are disconnected", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given - a previous complete provider snapshot includes two connected providers
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google", "anthropic"],
							all: [
								{
									id: "google",
									models: {
										"gemini-3.1-pro": { id: "gemini-3.1-pro" },
									},
								},
								{
									id: "anthropic",
									models: {
										"claude-opus-4-7": { id: "claude-opus-4-7" },
									},
								},
							],
						},
					}),
				},
			})

			//#when - a later full provider list still knows anthropic but no longer marks it connected
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google"],
							all: [
								{
									id: "google",
									models: {
										"gemini-3.1-pro": { id: "gemini-3.1-pro" },
									},
								},
								{
									id: "anthropic",
									models: {
										"claude-opus-4-7": { id: "claude-opus-4-7" },
									},
								},
							],
						},
					}),
				},
			})

			//#then - disconnected providers are not kept eligible for model fallback
			expect(testCacheStore.readConnectedProvidersCache()).toEqual(["google"])
			expect(testCacheStore.readProviderModelsCache()).toMatchObject({
				connected: ["google"],
				models: {
					google: [{ id: "gemini-3.1-pro" }],
				},
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("clears connected providers when a complete refresh reports none connected", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given - a previous complete provider snapshot includes connected providers
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["google", "anthropic"],
							all: [
								{ id: "google", models: { "gemini-3.1-pro": { id: "gemini-3.1-pro" } } },
								{ id: "anthropic", models: { "claude-opus-4-7": { id: "claude-opus-4-7" } } },
							],
						},
					}),
				},
			})

			//#when - a full provider list confirms neither provider is connected
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: [],
							all: [
								{ id: "google", models: { "gemini-3.1-pro": { id: "gemini-3.1-pro" } } },
								{ id: "anthropic", models: { "claude-opus-4-7": { id: "claude-opus-4-7" } } },
							],
						},
					}),
				},
			})

			//#then - all disconnected providers are evicted from fallback reachability
			expect(testCacheStore.readConnectedProvidersCache()).toEqual([])
			expect(testCacheStore.readProviderModelsCache()).toMatchObject({
				connected: [],
				models: {},
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("writes empty models when provider has no models", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["empty-provider"],
							all: [
								{
									id: "empty-provider",
									name: "Empty",
									env: [],
									models: {},
								},
							],
						},
					}),
				},
			}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.models).toEqual({})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("clears stale models when a connected provider explicitly reports no models", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given - a previous provider snapshot includes model metadata for a connected provider
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {
										"gpt-5.5": { id: "gpt-5.5" },
									},
								},
							],
						},
					}),
				},
			})

			//#when - a later authoritative refresh reports the provider with an empty model list
			await testCacheStore.updateConnectedProvidersCache({
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {},
								},
							],
						},
					}),
				},
			})

			//#then - old models are not restored into the connected provider's cache entry
			expect(testCacheStore.readProviderModelsCache()).toMatchObject({
				connected: ["openai"],
				models: {
					openai: [],
				},
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("writes empty models when all field is missing", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
						},
					}),
				},
			}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).not.toBeNull()
			expect(cache!.models).toEqual({})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("does nothing when client.provider.list is not available", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache).toBeNull()
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("does not remove unrelated files in the cache directory", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		//#given
		const realCacheDir = join(fakeUserCacheRoot, "oh-my-opencode")
		const sentinelPath = join(realCacheDir, "connected-providers-cache.test-sentinel.json")
		mkdirSync(realCacheDir, { recursive: true })
		writeFileSync(sentinelPath, JSON.stringify({ keep: true }))

		const mockClient = {
			provider: {
				list: async () => ({
					data: {
						connected: ["openai"],
						all: [
							{
								id: "openai",
								models: {
									"gpt-5.4": { id: "gpt-5.4" },
								},
							},
						],
					},
				}),
			},
		}

		try {
			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			expect(testCacheStore.readConnectedProvidersCache()).toEqual(["openai"])
			expect(existsSync(sentinelPath)).toBe(true)
			expect(readFileSync(sentinelPath, "utf-8")).toBe(JSON.stringify({ keep: true }))
		} finally {
			if (existsSync(sentinelPath)) {
				rmSync(sentinelPath, { force: true })
			}
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("findProviderModelMetadata returns rich cached metadata", async () => {
		const {
			createConnectedProvidersCacheStore,
			findProviderModelMetadata,
		} = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {
										"gpt-5.4": {
											id: "gpt-5.4",
											name: "GPT-5.4",
											temperature: false,
											variants: {
												low: {},
												high: {},
											},
											limit: { output: 128000 },
										},
									},
								},
							],
						},
					}),
				},
			}

			await testCacheStore.updateConnectedProvidersCache(mockClient)
			const cache = testCacheStore.readProviderModelsCache()

			//#when
			const result = findProviderModelMetadata("openai", "gpt-5.4", cache)

			//#then
			expect(result).toEqual({
				id: "gpt-5.4",
				name: "GPT-5.4",
				temperature: false,
				variants: {
					low: {},
					high: {},
				},
				limit: { output: 128000 },
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("keeps normalized fallback ids when raw metadata id is not a string", async () => {
		const {
			createConnectedProvidersCacheStore,
			findProviderModelMetadata,
		} = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["openai"],
							all: [
								{
									id: "openai",
									models: {
										"o3-mini": {
											id: 123,
											name: "o3-mini",
										},
									},
								},
							],
						},
					}),
				},
			}

			await testCacheStore.updateConnectedProvidersCache(mockClient)
			const cache = testCacheStore.readProviderModelsCache()

			expect(cache?.models.openai).toEqual([
				{ id: "o3-mini", name: "o3-mini" },
			])
			expect(findProviderModelMetadata("openai", "o3-mini", cache)).toEqual({
				id: "o3-mini",
				name: "o3-mini",
			})
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})

	test("given a previous cache with live-only ids that provider.list now reports, when updating, then the registry baseline excludes them", async () => {
		const { createConnectedProvidersCacheStore } = await importFreshConnectedProvidersCacheModule()
		const { testCacheStore, fakeUserCacheRoot } = createTestCacheContext(createConnectedProvidersCacheStore)

		try {
			//#given
			// Previous cache: registry declares glm-5.2; live also has the
			// live-only glm-5.3-flash (injected into config by a session).
			testCacheStore.writeProviderModelsCache({
				models: {
					neuralwatt: [
						{ id: "glm-5.2", name: "GLM 5.2" },
						{ id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
					],
				},
				registryModels: { neuralwatt: ["glm-5.2"] },
				connected: ["neuralwatt"],
			})
			// provider.list reports the effective model list, which includes the
			// config-injected live-only id.
			const mockClient = {
				provider: {
					list: async () => ({
						data: {
							connected: ["neuralwatt"],
							all: [
								{
									id: "neuralwatt",
									name: "NeuralWatt",
									env: [],
									models: {
										"glm-5.2": { id: "glm-5.2", name: "GLM 5.2" },
										"glm-5.3-flash": { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
									},
								},
							],
						},
					}),
				},
			}

			//#when
			await testCacheStore.updateConnectedProvidersCache(mockClient)

			//#then
			const cache = testCacheStore.readProviderModelsCache()
			expect(cache?.registryModels?.neuralwatt).toEqual(["glm-5.2"])
		} finally {
			cleanupTestCacheContext(fakeUserCacheRoot)
		}
	})
})

describe("isProviderModelsCacheStale", () => {
	function setupCacheDir(): string {
		const fakeCacheRoot = mkdtempSync(join(tmpdir(), "provider-cache-stale-"))
		process.env.XDG_CACHE_HOME = fakeCacheRoot
		return fakeCacheRoot
	}

	function writeProviderModelsCache(updatedAt: string): void {
		const cacheDir = join(process.env.XDG_CACHE_HOME!, "oh-my-opencode")
		mkdirSync(cacheDir, { recursive: true })
		writeFileSync(
			join(cacheDir, "provider-models.json"),
			JSON.stringify({ models: {}, connected: [], updatedAt }),
		)
	}

	function cleanupCacheDir(fakeCacheRoot: string): void {
		delete process.env.XDG_CACHE_HOME
		if (existsSync(fakeCacheRoot)) {
			rmSync(fakeCacheRoot, { recursive: true, force: true })
		}
	}

	test("reports stale when the cache file is missing", async () => {
		const fakeCacheRoot = setupCacheDir()
		try {
			//#given - no provider-models.json on disk
			const { isProviderModelsCacheStale, PROVIDER_CACHE_MAX_AGE_MS } =
				await importFreshConnectedProvidersCacheModule()

			//#when
			const stale = isProviderModelsCacheStale(PROVIDER_CACHE_MAX_AGE_MS)

			//#then
			expect(stale).toBe(true)
		} finally {
			cleanupCacheDir(fakeCacheRoot)
		}
	})

	test("reports fresh when updatedAt is within the max age", async () => {
		const fakeCacheRoot = setupCacheDir()
		try {
			//#given
			writeProviderModelsCache(new Date().toISOString())
			const { isProviderModelsCacheStale, PROVIDER_CACHE_MAX_AGE_MS } =
				await importFreshConnectedProvidersCacheModule()

			//#when
			const stale = isProviderModelsCacheStale(PROVIDER_CACHE_MAX_AGE_MS)

			//#then
			expect(stale).toBe(false)
		} finally {
			cleanupCacheDir(fakeCacheRoot)
		}
	})

	test("reports stale when updatedAt is older than the max age", async () => {
		const fakeCacheRoot = setupCacheDir()
		try {
			//#given
			const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
			writeProviderModelsCache(old)
			const { isProviderModelsCacheStale, PROVIDER_CACHE_MAX_AGE_MS } =
				await importFreshConnectedProvidersCacheModule()

			//#when
			const stale = isProviderModelsCacheStale(PROVIDER_CACHE_MAX_AGE_MS)

			//#then
			expect(stale).toBe(true)
		} finally {
			cleanupCacheDir(fakeCacheRoot)
		}
	})
})
