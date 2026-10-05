/**
 * M7 standing regression exam — one command.
 *
 * Encodes the repeatable M7 regression checks as a single invocation:
 *   1. 5-parallel children survive and complete (no kills, no empty children)
 *   2. expected child tool surface (union intersects requiredBaseline)
 *   3. no verdict-noise regressions (`gone from status` = 0, `Step interrupted`
 *      = 0, `degrading to no-op` = 0)
 *
 * It delegates the full sandbox run to the shared driver (regression mode) and
 * exits non-zero if any class fails. Run:
 *   bun script/qa/opencode-v2-qa-exam.ts
 */
import { runQa } from "./opencode-v2-qa-driver.ts"
import { REQUIRED_PARALLEL_CHILDREN, VERDICT_NOISE_MARKERS } from "./opencode-v2-qa-types.ts"
import { readFileSync } from "node:fs"
import { join } from "node:path"

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const keep = args.includes("--keep")
  const result = await runQa({ mode: "regression", keepSandbox: keep })

  const classes: string[] = []
  classes.push(
    `1. 5-parallel survive+complete: children=${result.childCount} (>=${REQUIRED_PARALLEL_CHILDREN}), ` +
      `withToolSurface=${result.childrenWithToolSurface}`,
  )
  classes.push(`2. child tool surface: { ${result.toolUnion.join(", ") || "none"} }`)
  classes.push(`3. no verdict-noise: ${VERDICT_NOISE_MARKERS.map((m) => `${m}=${result.verdictNoise[m] ?? 0}`).join(", ")}`)

  // M2b worker-class surface coverage: declared requiredPresence (full expected
  // surface, proven by unit tests) vs livePresenceGate (the subset the sandbox can
  // actually exercise). codegraph/skill are not observable in this sandbox.
  let presenceLine = "n/a"
  try {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "opencode-v2-qa-tool-surface.json"), "utf8"))
    const worker = manifest.agents?.["sisyphus-junior"]
    if (worker) {
      const reqCov = (worker.requiredPresence as string[]).filter((t: string) => result.toolUnion.includes(t))
      const liveCov = (worker.livePresenceGate as string[]).filter((t: string) => result.toolUnion.includes(t))
      const reqMiss = (worker.requiredPresence as string[]).filter((t: string) => !result.toolUnion.includes(t))
      presenceLine =
        `requiredPresence covered=${reqCov.length}/${worker.requiredPresence.length} ` +
        `missing=[${reqMiss.join(",") || "none"}]; ` +
        `livePresenceGate covered=${liveCov.length}/${worker.livePresenceGate.length}`
    }
  } catch {}
  classes.push(`4. worker surface (M2b): ${presenceLine}`)

  console.log("M7+M2b standing regression exam")
  for (const c of classes) console.log(`  ${c}`)
  console.log(`  result: ${result.passed ? "PASS" : "FAIL"}`)
  console.log(`  evidence: ${result.evidenceDir}`)
  if (!result.passed) {
    console.log(`  failures: ${result.failures.join("; ")}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
