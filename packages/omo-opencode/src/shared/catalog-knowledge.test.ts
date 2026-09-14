import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const moduleSpecifier = import.meta.resolve("./catalog-knowledge")

const existsSyncMock = mock((_: string) => false)
const readFileSyncMock = mock((_: string, __?: string) => "")
const writeFileSyncMock = mock((_: string, __: string, ___?: string) => {})
const mkdirSyncMock = mock((_: string, __?: unknown) => undefined)
const homedirMock = mock(() => "/tmp/test-home")

async function loadModule(): Promise<typeof import("./catalog-knowledge")> {
  return await import(`${moduleSpecifier}?test=${crypto.randomUUID()}`)
}

function registerMocks(): void {
  mock.module("node:fs", () => ({
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock,
  }))
  mock.module("node:os", () => ({
    homedir: homedirMock,
  }))
}

describe("catalog-knowledge", () => {
  beforeEach(() => {
    registerMocks()
    existsSyncMock.mockClear()
    readFileSyncMock.mockClear()
    writeFileSyncMock.mockClear()
    mkdirSyncMock.mockClear()
    homedirMock.mockClear()
  })

  afterEach(() => {
    mock.restore()
  })

  describe("readCatalogKnowledge", () => {
    it("returns empty catalog when file does not exist", async () => {
      existsSyncMock.mockReturnValue(false)
      const mod = await loadModule()

      const result = mod.readCatalogKnowledge()

      expect(result.version).toBe(1)
      expect(result.entries).toEqual({})
      expect(typeof result.updatedAt).toBe("string")
    })

    it("returns empty catalog when file contains corrupt JSON", async () => {
      existsSyncMock.mockReturnValue(true)
      readFileSyncMock.mockReturnValue("{ invalid json }")
      const mod = await loadModule()

      const result = mod.readCatalogKnowledge()

      expect(result.version).toBe(1)
      expect(result.entries).toEqual({})
    })

    it("returns empty catalog when version mismatch", async () => {
      existsSyncMock.mockReturnValue(true)
      readFileSyncMock.mockReturnValue(JSON.stringify({ version: 99, entries: {}, updatedAt: "2024-01-01T00:00:00Z" }))
      const mod = await loadModule()

      const result = mod.readCatalogKnowledge()

      expect(result.version).toBe(1)
      expect(result.entries).toEqual({})
    })

    it("returns parsed catalog when file is valid", async () => {
      existsSyncMock.mockReturnValue(true)
      const validData = {
        version: 1,
        entries: {
          "openai/gpt-4": {
            id: "gpt-4",
            provider: "openai",
            sources: ["https://example.com"],
            fetchedAt: "2024-01-01T00:00:00Z",
          },
        },
        updatedAt: "2024-01-01T00:00:00Z",
      }
      readFileSyncMock.mockReturnValue(JSON.stringify(validData))
      const mod = await loadModule()

      const result = mod.readCatalogKnowledge()

      expect(result.version).toBe(1)
      expect(result.entries["openai/gpt-4"]).toBeDefined()
      expect(result.entries["openai/gpt-4"].id).toBe("gpt-4")
    })
  })

  describe("upsertCatalogKnowledge", () => {
    it("merges new entries and persists", async () => {
      existsSyncMock.mockReturnValue(true)
      const existingData = {
        version: 1,
        entries: {
          "openai/gpt-4": {
            id: "gpt-4",
            provider: "openai",
            sources: ["https://old.com"],
            fetchedAt: "2024-01-01T00:00:00Z",
          },
        },
        updatedAt: "2024-01-01T00:00:00Z",
      }
      readFileSyncMock.mockReturnValue(JSON.stringify(existingData))
      const mod = await loadModule()

      const newEntry = {
        id: "claude-3",
        provider: "anthropic",
        sources: ["https://anthropic.com"],
        fetchedAt: "2024-06-01T00:00:00Z",
      }
      const result = mod.upsertCatalogKnowledge([newEntry])

      expect(result.entries["openai/gpt-4"]).toBeDefined()
      expect(result.entries["anthropic/claude-3"]).toBeDefined()
      expect(result.entries["anthropic/claude-3"].id).toBe("claude-3")
      expect(writeFileSyncMock).toHaveBeenCalled()
    })

    it("skips entries without required fields", async () => {
      existsSyncMock.mockReturnValue(false)
      const mod = await loadModule()

      const invalidEntry = { id: "test" } as never
      const result = mod.upsertCatalogKnowledge([invalidEntry])

      expect(Object.keys(result.entries)).toHaveLength(0)
    })
  })

  describe("mergeKnowledgeProfile", () => {
    it("returns base unchanged when knowledge is undefined", async () => {
      const mod = await loadModule()
      const base = { description: "existing", strengths: ["a"] }

      const result = mod.mergeKnowledgeProfile(base, undefined)

      expect(result).toEqual(base)
    })

    it("returns base unchanged when base is undefined", async () => {
      const mod = await loadModule()
      const knowledge = {
        id: "test",
        sources: ["https://example.com"],
        fetchedAt: "2024-01-01T00:00:00Z",
        description: "new",
      }

      const result = mod.mergeKnowledgeProfile(undefined, knowledge)

      expect(result).toBeUndefined()
    })

    it("fills gaps from knowledge without overwriting populated base fields", async () => {
      const mod = await loadModule()
      const base = {
        description: "existing description",
        strengths: ["existing-strength"],
        weaknesses: [] as string[],
      }
      const knowledge = {
        id: "test",
        sources: ["https://example.com"],
        fetchedAt: "2024-01-01T00:00:00Z",
        description: "new description",
        strengths: ["new-strength"],
        weaknesses: ["new-weakness"],
        bestFor: ["use-case-1"],
      }

      const result = mod.mergeKnowledgeProfile(base, knowledge)

      expect(result?.description).toBe("existing description")
      expect(result?.strengths).toEqual(["existing-strength"])
      expect(result?.weaknesses).toEqual(["new-weakness"])
      expect(result?.bestFor).toEqual(["use-case-1"])
    })
  })

  describe("listModelsMissingKnowledge", () => {
    it("returns keys with no entry in the cache", async () => {
      existsSyncMock.mockReturnValue(true)
      const catalogData = {
        version: 1,
        entries: {
          "openai/gpt-4": {
            id: "gpt-4",
            provider: "openai",
            sources: ["https://example.com"],
            fetchedAt: "2024-01-01T00:00:00Z",
          },
        },
        updatedAt: "2024-01-01T00:00:00Z",
      }
      readFileSyncMock.mockReturnValue(JSON.stringify(catalogData))
      const mod = await loadModule()

      const result = mod.listModelsMissingKnowledge(["openai/gpt-4", "anthropic/claude-3", "google/gemini"])

      expect(result).toEqual(["anthropic/claude-3", "google/gemini"])
    })

    it("returns empty array when all keys are known", async () => {
      existsSyncMock.mockReturnValue(true)
      const catalogData = {
        version: 1,
        entries: {
          "openai/gpt-4": {
            id: "gpt-4",
            provider: "openai",
            sources: ["https://example.com"],
            fetchedAt: "2024-01-01T00:00:00Z",
          },
        },
        updatedAt: "2024-01-01T00:00:00Z",
      }
      readFileSyncMock.mockReturnValue(JSON.stringify(catalogData))
      const mod = await loadModule()

      const result = mod.listModelsMissingKnowledge(["openai/gpt-4"])

      expect(result).toEqual([])
    })
  })
})
