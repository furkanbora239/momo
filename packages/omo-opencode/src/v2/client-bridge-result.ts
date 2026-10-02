import { log } from "../shared/logger"

/**
 * V1 SDK responses resolve to a `{ data, error }` envelope (the hey-api
 * RequestResult with throwOnError defaulting to false). V2 ctx methods return
 * the payload directly or throw, so every bridge wraps the V2 call into this
 * envelope. The `request`/`response` fields of the V1 envelope are omitted: no
 * momo call site reads them (verified by grep across src/).
 */
export type V1ClientResult<TData> =
  | { data: TData; error: undefined }
  | { data: undefined; error: unknown }

export async function toV1Result<TData>(
  operation: () => Promise<TData>,
): Promise<V1ClientResult<TData>> {
  try {
    return { data: await operation(), error: undefined }
  } catch (error: unknown) {
    return { data: undefined, error }
  }
}

/**
 * Logged no-op for V1 client methods momo calls that have no faithful V2 ctx
 * equivalent. Resolves undefined; never fabricates success data.
 */
export function createUnmappedNoOpMethod(
  api: string,
  reason: string,
  logFn: (message: string, data?: unknown) => void = log,
): () => Promise<undefined> {
  return async () => {
    logFn(`[v2-client-bridge] ${api} is not mapped under OpenCode V2 (${reason}); degrading to no-op`)
    return undefined
  }
}
