// advisor-flow.probe.ts — harness-level exercise of the momo advisor runtime.
//
// Drives the EXACT functions the plugin wires:
//   - resolveAdvisorDelegationGate (src/tools/delegate-task/advisor-delegation-gate.ts)
//     — invoked at delegation time in subagent-resolver.ts (parentSessionID passed
//     from tools.ts). When unbound, delegation is rejected; when bound, it
//     proceeds.
//   - createAdvisorTool().execute (src/tools/advisor/tools.ts) — the native
//     `advisor` tool registered via tool-registry-core-tools.ts. Mutates the
//     session-scoped binding store (src/agents/advisor-binding.ts).
//
// These are the same source modules the dist bundle contains. The probe runs
// them in the same sandbox the plugin boots in (HOME/XDG_DATA_HOME pointed at the
// temp dir), so the session binding store is the live one.

import { resolveAdvisorDelegationGate } from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/tools/delegate-task/advisor-delegation-gate.ts"
import { createAdvisorTool } from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/tools/advisor/tools.ts"
import {
  clearSessionAdvisorBinding,
  getSessionAdvisorBinding,
  setSessionAdvisorBinding,
} from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/agents/advisor-binding.ts"

const SESSION_ID = "ses_momo_evidence_4a"
const MODEL = "neuralwatt/glm-5.2"

// Clean slate.
clearSessionAdvisorBinding(SESSION_ID)

interface Step {
  readonly step: string
  readonly gateKind?: string
  readonly gateError?: string
  readonly gateSessionModel?: string
  readonly toolOutput?: string
  readonly bound?: boolean
  readonly sessionBinding?: string | undefined
}

function emit(step: Step): void {
  process.stdout.write(JSON.stringify(step) + "\n")
}

const advisor = createAdvisorTool({ configModel: undefined })

// --- Step 1: unbound -> delegation rejected ---
{
  const gate = resolveAdvisorDelegationGate("advisor", undefined, SESSION_ID)
  emit({
    step: "1-unbound-delegation",
    gateKind: gate.kind,
    gateError: gate.kind === "unbound" ? gate.error : undefined,
    sessionBinding: getSessionAdvisorBinding(SESSION_ID),
  })
}

// --- Step 2: bind via the advisor tool ---
{
  const out = await advisor.execute(
    { action: "bind", model: MODEL },
    { sessionID: SESSION_ID },
  )
  emit({
    step: "2-bind-via-advisor-tool",
    toolOutput: typeof out === "string" ? out : JSON.stringify(out),
    sessionBinding: getSessionAdvisorBinding(SESSION_ID),
  })
}

// --- Step 3: delegation now succeeds (gate -> bound) ---
{
  const gate = resolveAdvisorDelegationGate("advisor", undefined, SESSION_ID)
  emit({
    step: "3-bound-delegation",
    gateKind: gate.kind,
    gateSessionModel: gate.kind === "bound" ? gate.sessionModel : undefined,
    sessionBinding: getSessionAdvisorBinding(SESSION_ID),
  })
}

// --- Step 4: /advisor off -> unbind ---
{
  const out = await advisor.execute({ action: "off" }, { sessionID: SESSION_ID })
  emit({
    step: "4-off-via-advisor-tool",
    toolOutput: typeof out === "string" ? out : JSON.stringify(out),
    sessionBinding: getSessionAdvisorBinding(SESSION_ID),
  })
}

// --- Step 5: delegation rejected again ---
{
  const gate = resolveAdvisorDelegationGate("advisor", undefined, SESSION_ID)
  emit({
    step: "5-unbound-again",
    gateKind: gate.kind,
    gateError: gate.kind === "unbound" ? gate.error : undefined,
    sessionBinding: getSessionAdvisorBinding(SESSION_ID),
  })
}

// --- Step 6: /advisor report (no args) after off ---
{
  const out = await advisor.execute({}, { sessionID: SESSION_ID })
  emit({
    step: "6-report-after-off",
    toolOutput: typeof out === "string" ? out : JSON.stringify(out),
  })
}

// --- Step 7: bind again, then off with configModel present (config-binding message) ---
{
  setSessionAdvisorBinding(SESSION_ID, "neuralwatt/glm-5.2")
  const advisorWithConfig = createAdvisorTool({ configModel: "google/gemini-3.1-pro" })
  const out = await advisorWithConfig.execute({ action: "off" }, { sessionID: SESSION_ID })
  emit({
    step: "7-off-with-config-binding",
    toolOutput: typeof out === "string" ? out : JSON.stringify(out),
  })
}