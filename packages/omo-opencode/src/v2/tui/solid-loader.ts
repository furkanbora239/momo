import { log } from "../../shared/logger"
import type { SolidRuntime } from "../../features/tui-card"

type SolidModule = typeof import("@opentui/solid")

/** Node type produced by the dynamically imported @opentui/solid runtime. */
export type SolidNode = ReturnType<SolidModule["createElement"]>

/**
 * Loads the @opentui/solid runtime helpers the same way the V1 TUI module
 * does: a dynamic import that degrades to null (with one log line) when the
 * runtime is unavailable, so the plugin never hard-fails on import.
 */
export async function loadSolidRuntime(): Promise<SolidRuntime<SolidNode> | null> {
  const solid = await import("@opentui/solid").catch((error: unknown) => {
    log("[v2-tui] @opentui/solid runtime unavailable; V2 TUI surface skipped", {
      error: String(error),
    })
    return null
  })
  return solid
}
