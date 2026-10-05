import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  PER_AGENT_TOOL_SURFACE,
  WORKER_CLASS_AGENTS,
  WORKER_PRESENCE_GATE,
  buildQaManifest,
  type AgentClass,
} from "./agent-tool-surface"
import { getAgentToolRestrictions } from "./agent-tool-restrictions"
import { deriveAllowedToolNames, deriveRemovedToolNames } from "./session-tools-store"

const MANIFEST_PATH = join(
  process.cwd(),
  "script",
  "qa",
  "opencode-v2-qa-tool-surface.json",
)

const ROSTER: Array<{ name: string; agentClass: AgentClass }> = [
  { name: "sisyphus", agentClass: "orchestrator" },
  { name: "planner", agentClass: "planner" },
  { name: "sisyphus-junior", agentClass: "worker" },
  { name: "worker", agentClass: "worker" },
  { name: "executor", agentClass: "worker" },
  { name: "advisor", agentClass: "advisor" },
  { name: "explore", agentClass: "read-only" },
  { name: "librarian", agentClass: "read-only" },
  { name: "research", agentClass: "read-only" },
  { name: "reviewer", agentClass: "manager" },
  { name: "catalog-researcher", agentClass: "researcher" },
]

describe("M2b per-agent tool surface — coverage", () => {
  test("every kept-roster agent has an explicit surface under V2 naming", () => {
    for (const { name } of ROSTER) {
      expect(PER_AGENT_TOOL_SURFACE[name], `missing map for ${name}`).toBeDefined()
    }
  })

  test("maps derive from M2a helpers (getAgentToolRestrictions + derive fns)", () => {
    for (const { name } of ROSTER) {
      const restrictions = getAgentToolRestrictions(name)
      const surface = PER_AGENT_TOOL_SURFACE[name]
      expect(surface.allowed).toEqual(deriveAllowedToolNames(restrictions))
      expect(surface.removed).toEqual(deriveRemovedToolNames(restrictions))
    }
  })

  test("uses V2 names only — no stale bash/task/write/patch", () => {
    const stale = new Set(["bash", "task", "write", "patch", "apply_patch"])
    for (const surface of Object.values(PER_AGENT_TOOL_SURFACE)) {
      for (const t of [...surface.allowed, ...surface.removed]) {
        expect(stale.has(t), `stale V1 name ${t} in ${JSON.stringify(surface)}`).toBe(false)
      }
    }
  })
})

describe("M2b worker-class surface", () => {
  test("worker-class agents positively include the read-side baseline (presence, not only absence)", () => {
    const want = new Set(WORKER_PRESENCE_GATE)
    for (const name of WORKER_CLASS_AGENTS) {
      const allowed = new Set(PER_AGENT_TOOL_SURFACE[name].allowed)
      for (const t of want) {
        expect(allowed.has(t), `worker ${name} missing requiredPresence ${t}`).toBe(true)
      }
    }
  })

  test("sisyphus-junior/worker deny subagent (V2 rename of task); executor may spawn", () => {
    // sisyphus-junior and worker are direct-execution workers that must not
    // re-delegate via subagent; executor is a manager-layer worker that may.
    expect(PER_AGENT_TOOL_SURFACE["sisyphus-junior"].removed).toContain("subagent")
    expect(PER_AGENT_TOOL_SURFACE["worker"].removed).toContain("subagent")
    expect(PER_AGENT_TOOL_SURFACE["executor"].removed).not.toContain("subagent")
    for (const name of WORKER_CLASS_AGENTS) {
      expect(PER_AGENT_TOOL_SURFACE[name].removed).not.toContain("task")
    }
  })

  test("executor denies edit + call_omo_agent but keeps the read-side baseline", () => {
    const executor = PER_AGENT_TOOL_SURFACE["executor"]
    expect(executor.removed).toContain("edit")
    expect(executor.removed).toContain("call_omo_agent")
    expect(executor.allowed).toContain("codegraph_explore")
    expect(executor.allowed).toContain("skill")
  })
})

describe("M2b read-only surface", () => {
  test("explore/librarian/research deny edit, subagent and call_omo_agent", () => {
    for (const name of ["explore", "librarian", "research"]) {
      const removed = PER_AGENT_TOOL_SURFACE[name].removed
      expect(removed).toContain("edit")
      expect(removed).toContain("subagent")
      expect(removed).toContain("call_omo_agent")
      // read-only agents must NOT carry the worker baseline
      expect(PER_AGENT_TOOL_SURFACE[name].allowed).not.toContain("codegraph_explore")
      expect(PER_AGENT_TOOL_SURFACE[name].allowed).not.toContain("skill")
    }
  })
})

describe("M2b manifest generation", () => {
  test("buildQaManifest promotes advisoryPresence to a hard requiredPresence gate for worker-class", () => {
    const manifest = buildQaManifest()
    for (const name of WORKER_CLASS_AGENTS) {
      const entry = manifest.agents[name]
      expect(entry.class).toBe("worker")
      expect(entry.requiredPresence.sort()).toEqual([...WORKER_PRESENCE_GATE].sort())
    }
  })

  test("manifest requiredPresence is a subset of the agent's allowed set (no drift)", () => {
    const manifest = buildQaManifest()
    for (const [name, entry] of Object.entries(manifest.agents)) {
      const allowed = new Set(PER_AGENT_TOOL_SURFACE[name].allowed)
      for (const t of entry.requiredPresence) {
        expect(allowed.has(t), `manifest requiredPresence ${t} not in allowed for ${name}`).toBe(true)
      }
    }
  })
})

describe("M2b QA manifest drift guard (code map == committed JSON)", () => {
  test("committed script/qa manifest equals buildQaManifest()", () => {
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    expect(committed).toEqual(buildQaManifest())
  })

  test("every kept-roster agent appears in the manifest", () => {
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    for (const name of Object.keys(PER_AGENT_TOOL_SURFACE)) {
      expect(committed.agents[name], `manifest missing ${name}`).toBeDefined()
    }
  })

  test("worker-class entries carry the promoted hard requiredPresence gate", () => {
    const committed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    for (const name of WORKER_CLASS_AGENTS) {
      const entry = committed.agents[name]
      expect(entry.class).toBe("worker")
      expect(Array.isArray(entry.requiredPresence) && entry.requiredPresence.length).toBeGreaterThan(0)
      for (const t of ["codegraph_explore", "skill", "websearch", "webfetch"]) {
        expect(entry.requiredPresence).toContain(t)
      }
    }
  })
})
