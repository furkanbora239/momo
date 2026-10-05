/**
 * M2b manifest generator.
 *
 * Emits `script/qa/opencode-v2-qa-tool-surface.json` from the code-level single
 * source of truth in packages/omo-opencode/src/shared/agent-tool-surface.ts. Run
 * after editing the code map so the QA manifest can never drift from the live
 * V2 deny/allow logic. A test (agent-tool-surface-manifest.test.ts) asserts the
 * committed JSON stays equal to this output.
 *
 *   bun script/qa/gen-agent-tool-surface.ts
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildQaManifest } from "../../packages/omo-opencode/src/shared/agent-tool-surface.ts"

const manifest = buildQaManifest()
const outPath = join(import.meta.dir, "opencode-v2-qa-tool-surface.json")
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n")
console.log(`wrote ${outPath}`)
console.log(`  agents: ${Object.keys(manifest.agents).join(", ")}`)
const workers = Object.entries(manifest.agents).filter(([, e]) => e.class === "worker")
for (const [name, e] of workers) {
  console.log(`  worker ${name} requiredPresence: ${e.requiredPresence.join(", ")}`)
}
