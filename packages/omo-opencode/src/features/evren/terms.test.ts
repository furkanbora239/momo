import { describe, expect, it } from "bun:test"

import { acceptEvrenTerms, fetchEvrenTermsText, readEvrenApiKey } from "./terms"

type RecordedCall = {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

function createRecordingFetch(respond: () => Response | Promise<Response>): {
  fetchImpl: typeof fetch
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? init.body : null,
    })
    return respond()
  }
  return { fetchImpl, calls }
}

function createThrowingFetch(error: Error): typeof fetch {
  return (async () => {
    throw error
  }) as typeof fetch
}

const testBaseUrl = "https://evren.example.test/v1"

describe("fetchEvrenTermsText", () => {
  it("#given a successful terms response #when fetching #then text and version are returned via GET to the terms endpoint", async () => {
    const { fetchImpl, calls } = createRecordingFetch(
      () =>
        new Response(
          JSON.stringify({ version: 1, doc_path: "/terms/v1.md", content: "TERMS TEXT" }),
          { status: 200 },
        ),
    )

    const result = await fetchEvrenTermsText(testBaseUrl, fetchImpl)

    expect(result).toEqual({ ok: true, text: "TERMS TEXT", version: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${testBaseUrl}/terms/text`)
    expect(calls[0]?.method).toBe("GET")
  })

  it("#given an HTTP error response #when fetching #then the result carries the status", async () => {
    const { fetchImpl } = createRecordingFetch(() => new Response("forbidden", { status: 403 }))

    const result = await fetchEvrenTermsText(testBaseUrl, fetchImpl)

    expect(result).toEqual({ ok: false, error: expect.stringContaining("403") })
  })

  it("#given a fetch that throws #when fetching #then the result is an error and nothing throws", async () => {
    const result = await fetchEvrenTermsText(testBaseUrl, createThrowingFetch(new Error("network down")))

    expect(result).toEqual({ ok: false, error: expect.stringContaining("network down") })
  })

  it("#given an aborted request #when fetching #then the result is an error", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError")

    const result = await fetchEvrenTermsText(testBaseUrl, createThrowingFetch(abortError))

    expect(result).toEqual({ ok: false, error: expect.stringContaining("aborted") })
  })

  it("#given a response with an invalid payload #when fetching #then the result is an error", async () => {
    const { fetchImpl } = createRecordingFetch(() => new Response(JSON.stringify({ version: 1 }), { status: 200 }))

    const result = await fetchEvrenTermsText(testBaseUrl, fetchImpl)

    expect(result).toEqual({ ok: false, error: expect.stringContaining("invalid") })
  })
})

describe("acceptEvrenTerms", () => {
  it("#given a valid API key #when accepting terms v1 #then it POSTs the version JSON with the bearer key", async () => {
    const { fetchImpl, calls } = createRecordingFetch(
      () =>
        new Response(
          JSON.stringify({ accepted_version: 1, accepted_at: "2026-09-22T00:00:00.000Z" }),
          { status: 200 },
        ),
    )

    const result = await acceptEvrenTerms({
      baseUrl: testBaseUrl,
      apiKey: "evren_llm_test_key",
      fetchImpl,
    })

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${testBaseUrl}/terms/accept`)
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer evren_llm_test_key")
    expect(calls[0]?.body).toBe(JSON.stringify({ version: 1 }))
  })

  it("#given an explicit version #when accepting #then the body carries that version", async () => {
    const { fetchImpl, calls } = createRecordingFetch(() => new Response("{}", { status: 200 }))

    const result = await acceptEvrenTerms({
      baseUrl: testBaseUrl,
      apiKey: "evren_llm_test_key",
      version: 2,
      fetchImpl,
    })

    expect(result).toEqual({ ok: true })
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ version: 2 })
  })

  it("#given an HTTP error response #when accepting #then the result carries the status", async () => {
    const { fetchImpl } = createRecordingFetch(() => new Response("forbidden", { status: 403 }))

    const result = await acceptEvrenTerms({
      baseUrl: testBaseUrl,
      apiKey: "evren_llm_test_key",
      fetchImpl,
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining("403") })
  })

  it("#given a fetch that throws #when accepting #then the result is an error and nothing throws", async () => {
    const result = await acceptEvrenTerms({
      baseUrl: testBaseUrl,
      apiKey: "evren_llm_test_key",
      fetchImpl: createThrowingFetch(new Error("boom")),
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining("boom") })
  })
})

describe("readEvrenApiKey", () => {
  it("#given EVREN_API_KEY in the environment #when reading the key #then the env value wins", () => {
    const original = process.env.EVREN_API_KEY
    process.env.EVREN_API_KEY = "evren_llm_env_key"
    try {
      expect(readEvrenApiKey()).toBe("evren_llm_env_key")
    } finally {
      if (original === undefined) delete process.env.EVREN_API_KEY
      else process.env.EVREN_API_KEY = original
    }
  })
})
