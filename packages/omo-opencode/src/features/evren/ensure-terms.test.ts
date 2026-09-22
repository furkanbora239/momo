import { describe, expect, it } from "bun:test"

import { createEvrenTermsEnsurer } from "./ensure-terms"

type EnsurerDeps = NonNullable<Parameters<typeof createEvrenTermsEnsurer>[0]>

type RecorderOptions = {
  status: "accepted" | "declined" | "unknown"
  key?: string
  ok?: boolean
  throwOnAccept?: Error
}

function createRecorderDeps(options: RecorderOptions): {
  deps: EnsurerDeps
  acceptCalls: () => number
  lastApiKey: () => string | undefined
} {
  let calls = 0
  let lastKey: string | undefined
  const deps: EnsurerDeps = {
    readConsentStatus: () => options.status,
    readApiKey: () => options.key,
    accept: async (params) => {
      calls += 1
      lastKey = params.apiKey
      if (options.throwOnAccept) throw options.throwOnAccept
      return { ok: options.ok ?? true }
    },
  }
  return { deps, acceptCalls: () => calls, lastApiKey: () => lastKey }
}

describe("createEvrenTermsEnsurer", () => {
  it("#given a consent status other than accepted #when ensuring #then accept is never called", async () => {
    for (const status of ["declined", "unknown"] as const) {
      const { deps, acceptCalls } = createRecorderDeps({ status, key: "evren_llm_key" })

      await createEvrenTermsEnsurer(deps)()

      expect(acceptCalls()).toBe(0)
    }
  })

  it("#given accepted consent but no api key #when ensuring #then accept is never called", async () => {
    const { deps, acceptCalls } = createRecorderDeps({ status: "accepted" })

    await createEvrenTermsEnsurer(deps)()

    expect(acceptCalls()).toBe(0)
  })

  it("#given accepted consent and a key #when ensuring twice #then accept runs once with the key and the result is cached", async () => {
    const { deps, acceptCalls, lastApiKey } = createRecorderDeps({
      status: "accepted",
      key: "evren_llm_key",
      ok: true,
    })
    const ensure = createEvrenTermsEnsurer(deps)

    await ensure()
    await ensure()

    expect(acceptCalls()).toBe(1)
    expect(lastApiKey()).toBe("evren_llm_key")
  })

  it("#given a failing accept #when ensuring twice #then the second call retries the acceptance", async () => {
    const { deps, acceptCalls } = createRecorderDeps({
      status: "accepted",
      key: "evren_llm_key",
      ok: false,
    })
    const ensure = createEvrenTermsEnsurer(deps)

    await ensure()
    await ensure()

    expect(acceptCalls()).toBe(2)
  })

  it("#given an accept that throws #when ensuring #then nothing throws and the next call retries", async () => {
    const { deps, acceptCalls } = createRecorderDeps({
      status: "accepted",
      key: "evren_llm_key",
      throwOnAccept: new Error("network down"),
    })
    const ensure = createEvrenTermsEnsurer(deps)

    await expect(ensure()).resolves.toBeUndefined()
    await ensure()

    expect(acceptCalls()).toBe(2)
  })
})
