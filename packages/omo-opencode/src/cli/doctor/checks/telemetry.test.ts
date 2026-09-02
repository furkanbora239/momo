/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const originalHome = process.env.HOME
const originalOmoDisablePostHog = process.env.OMO_DISABLE_POSTHOG
const originalOmoSendAnonymousTelemetry = process.env.OMO_SEND_ANONYMOUS_TELEMETRY

function resetEnv(): void {
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome
  }
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalOmoDisablePostHog === undefined) {
    delete process.env.OMO_DISABLE_POSTHOG
  } else {
    process.env.OMO_DISABLE_POSTHOG = originalOmoDisablePostHog
  }
  if (originalOmoSendAnonymousTelemetry === undefined) {
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
  } else {
    process.env.OMO_SEND_ANONYMOUS_TELEMETRY = originalOmoSendAnonymousTelemetry
  }
}

afterEach(() => {
  resetEnv()
})

describe("checkTelemetry", () => {
  it("reports default-disabled status and last daily active date", async () => {
    // given
    const dataHomePath = join(tmpdir(), `doctor-telemetry-${Date.now()}-${Math.random()}`)
    const stateDir = join(dataHomePath, "oh-my-opencode")
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, "posthog-activity.json"), `${JSON.stringify({ lastActiveDayUTC: "2026-06-28" })}\n`)
    process.env.XDG_DATA_HOME = dataHomePath
    const isolatedHomePath = mkdtempSync(join(tmpdir(), "doctor-telemetry-default-home-"))
    process.env.HOME = isolatedHomePath
    delete process.env.OMO_DISABLE_POSTHOG
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
    const { checkTelemetry } = await import(`./telemetry?default-off=${Date.now()}`)

    // when
    const result = await checkTelemetry()

    // then
    expect(result.status).toBe("pass")
    expect(result.message).toBe("Telemetry: disabled")
    expect(result.details).toContain("Last daily active date: 2026-06-28")
    rmSync(dataHomePath, { recursive: true, force: true })
    rmSync(isolatedHomePath, { recursive: true, force: true })
  })

  it("reports enabled status when the user config opts into telemetry", async () => {
    // given
    const isolatedHomePath = mkdtempSync(join(tmpdir(), "doctor-telemetry-optin-home-"))
    mkdirSync(join(isolatedHomePath, ".omo"), { recursive: true })
    writeFileSync(
      join(isolatedHomePath, ".omo", "omo.jsonc"),
      `${JSON.stringify({ "[opencode]": { telemetry: true } })}\n`,
    )
    process.env.HOME = isolatedHomePath
    delete process.env.OMO_DISABLE_POSTHOG
    delete process.env.OMO_SEND_ANONYMOUS_TELEMETRY
    const { checkTelemetry } = await import(`./telemetry?opt-in=${Date.now()}`)

    // when
    const result = await checkTelemetry()

    // then
    expect(result.status).toBe("pass")
    expect(result.message).toBe("Telemetry: enabled")
    rmSync(isolatedHomePath, { recursive: true, force: true })
  })

  it("reports disabled status when env disables PostHog", async () => {
    // given
    process.env.OMO_DISABLE_POSTHOG = "1"
    const { checkTelemetry } = await import(`./telemetry?disabled=${Date.now()}`)

    // when
    const result = await checkTelemetry()

    // then
    expect(result.status).toBe("pass")
    expect(result.message).toBe("Telemetry: disabled")
    expect(result.issues).toEqual([])
  })
})
