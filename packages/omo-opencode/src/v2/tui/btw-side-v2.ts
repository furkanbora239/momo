import { log } from "../../shared/logger"

/**
 * Explicit degradation: the V2 TUI plugin API publishes no session_prompt
 * (or session_prompt_right) slot, no Prompt component, and no prompt-ref
 * surface, so the btw-side side-conversation TUI feature (which is built
 * around taking over the session prompt and reading its ref) has no
 * faithful V2 equivalent. Logged once and skipped; no approximated
 * behavior is fabricated.
 */
export function registerBtwSideV2(): void {
  log(
    "[btw-side] V2 TUI API has no session_prompt slot or prompt-ref equivalent; TUI surface skipped",
  )
}
