import { describe, expect, it } from "bun:test"
import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import { createRegistrationCollector } from "./registration-collector"
import { createHookBridgeTestHarness, fireRegistration, registrationsFor, syntheticHandlers } from "./hook-bridge.test-support"
import { registerPermissionHooks } from "./permission-hook-bridge"

describe("registerPermissionHooks", () => {
  it("writes a V1 status mutation back to the V2 permission effect", async () => {
    const harness = createHookBridgeTestHarness()
    const collector = createRegistrationCollector()
    let retainedOutput: { status: "ask" | "deny" | "allow" } | undefined
    const hooks = {
      ...syntheticHandlers(),
      "permission.ask": async (_input, output) => {
        retainedOutput = output
        output.status = "deny"
      },
    } as unknown as HooksWithRuntimeLifecycle
    await registerPermissionHooks(harness.ctx, hooks, collector)
    const permissionHook = registrationsFor(harness, "permission", "evaluate")[0]!
    const event = { action: "bash", effect: "ask" as const, sessionID: "sess-1", message: "Run command" }

    await fireRegistration(permissionHook, event)

    expect(retainedOutput?.status).toBe("deny")
    expect(event.effect).toBe("deny")
  })
})
