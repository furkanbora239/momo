import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createEvrenConsentStore,
  hasEvrenConsent,
  readEvrenConsentStatus,
} from "./consent"

const tempDirs: string[] = []

function newConsentPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "evren-consent-test-"))
  tempDirs.push(dir)
  return join(dir, "evren-consent.json")
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("evren consent store", () => {
  it("#given no consent file #when reading #then status is unknown and the default record is declined", () => {
    const consentPath = newConsentPath()
    const store = createEvrenConsentStore(() => consentPath)

    expect(readEvrenConsentStatus(() => consentPath)).toBe("unknown")
    expect(hasEvrenConsent(() => consentPath)).toBe(false)

    const consent = store.readEvrenConsent()
    expect(consent.version).toBe(1)
    expect(consent.status).toBe("declined")
    expect(consent.termsVersion).toBe(0)
  })

  it("#given an accepted consent written to disk #when reading back #then the roundtrip preserves every field", () => {
    const consentPath = newConsentPath()
    const store = createEvrenConsentStore(() => consentPath)
    const consent = {
      version: 1,
      status: "accepted",
      termsVersion: 1,
      updatedAt: "2026-09-22T00:00:00.000Z",
    }

    store.writeEvrenConsent(consent)

    expect(store.readEvrenConsent()).toEqual(consent)
    expect(readEvrenConsentStatus(() => consentPath)).toBe("accepted")
    expect(hasEvrenConsent(() => consentPath)).toBe(true)
  })

  it("#given a declined consent written to disk #when reading the status #then it reports declined", () => {
    const consentPath = newConsentPath()
    const store = createEvrenConsentStore(() => consentPath)

    store.writeEvrenConsent({
      version: 1,
      status: "declined",
      termsVersion: 1,
      updatedAt: "2026-09-22T00:00:00.000Z",
    })

    expect(readEvrenConsentStatus(() => consentPath)).toBe("declined")
    expect(hasEvrenConsent(() => consentPath)).toBe(true)
  })

  it("#given a consent file containing invalid JSON #when reading #then status is unknown and nothing throws", () => {
    const consentPath = newConsentPath()
    writeFileSync(consentPath, "{not valid json", "utf-8")
    const store = createEvrenConsentStore(() => consentPath)

    expect(() => readEvrenConsentStatus(() => consentPath)).not.toThrow()
    expect(readEvrenConsentStatus(() => consentPath)).toBe("unknown")
    expect(hasEvrenConsent(() => consentPath)).toBe(false)
    expect(store.readEvrenConsent().status).toBe("declined")
  })

  it("#given a consent file with an invalid shape #when reading #then status is unknown", () => {
    const consentPath = newConsentPath()
    writeFileSync(
      consentPath,
      JSON.stringify({ version: 2, status: "accepted", termsVersion: 1 }),
      "utf-8",
    )

    expect(readEvrenConsentStatus(() => consentPath)).toBe("unknown")
    expect(hasEvrenConsent(() => consentPath)).toBe(false)
  })
})
