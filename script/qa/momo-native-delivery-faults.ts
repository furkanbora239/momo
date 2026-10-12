import { appendFileSync } from "node:fs"

export function installNativeQaDeliveryFaults(logPath: string): () => void {
  const original = globalThis.fetch
  const failed = new Set<string>()
  const attempts = new Map<string, number>()
  globalThis.fetch = Object.assign(async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const [source, options] = args
    const request = source instanceof Request ? source : undefined
    const url = new URL(request?.url ?? String(source))
    const method = options?.method ?? request?.method ?? "GET"
    if (method !== "POST" || !/\/api\/session\/[^/]+\/(?:form|synthetic)$/.test(url.pathname)) return original(...args)
    const payload: unknown = request ? await request.clone().json() : typeof options?.body === "string" ? JSON.parse(options.body) : undefined
    if (typeof payload !== "object" || payload === null || !("metadata" in payload) || typeof payload.metadata !== "object" || payload.metadata === null) return original(...args)
    const metadata = payload.metadata as Record<string, unknown>
    const kind = metadata.momoNativeFormKind === "question" ? "form" : metadata.momoNativeDelivery !== undefined ? "result" : undefined
    if (kind === undefined) return original(...args)
    const id = "id" in payload ? payload.id : undefined
    const count = (attempts.get(kind) ?? 0) + 1
    attempts.set(kind, count)
    let injected = !failed.has(kind)
    let parentBusy: boolean | undefined
    if (kind === "result" && injected) {
      const response = await original(new URL("/api/session/active", url), { headers: request?.headers ?? options?.headers })
      if (!response.ok) throw new Error(`QA parent activity lookup failed: ${response.status}`)
      const payload = await response.json() as Record<string, unknown>
      const active = typeof payload.data === "object" && payload.data !== null ? payload.data as Record<string, unknown> : payload
      const parentID = decodeURIComponent(url.pathname.split("/")[3] ?? "")
      parentBusy = active[parentID] !== undefined
      if (!parentBusy) injected = false
    }
    if (injected) failed.add(kind)
    appendFileSync(logPath, `${JSON.stringify({ kind, id, attempt: count, injected, ...(parentBusy === undefined ? {} : { parentBusy }) })}\n`, { mode: 0o600 })
    if (injected) return new Response(JSON.stringify({ name: "FixtureDeliveryUnavailable", message: "isolated transient delivery failure" }), { status: 503, headers: { "content-type": "application/json" } })
    return original(...args)
  }, original)
  return () => { globalThis.fetch = original }
}
