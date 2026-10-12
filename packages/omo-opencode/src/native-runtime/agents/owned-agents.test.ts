import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { installOwnedAgents } from "./owned-agents"

describe("owned native agent files", () => {
  test("emits real frontmatter and preserves same-name unowned user files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-owned-agents-"))
    try {
      const userFile = join(directory, "momo-worker.md")
      await writeFile(userFile, "---\ndescription: user's worker\nmode: all\n---\nkeep me\n")
      const result = installOwnedAgents(directory)
      const orchestrator = await readFile(join(directory, "momo-orchestrator.md"), "utf8")
      const parsed = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(orchestrator)
      expect(parsed).not.toBeNull()
      expect(parsed?.[1]).toContain("mode: primary")
      expect(parsed?.[1]).toContain("description:")
      expect(parsed?.[2]).toContain("momo-native-agent-owned:v1")
      expect(result.conflicts).toContain("momo-worker")
      expect(result.owned).not.toContain("momo-worker")
      expect(await readFile(userFile, "utf8")).toContain("keep me")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
