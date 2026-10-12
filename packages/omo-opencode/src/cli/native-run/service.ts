import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { isSupportedNativeRuntimeVersion } from "../../native-runtime/v2-service-client"
import type { NativeOpenCodeClient, NativeRunOptions } from "./types"

const MINIMUM_NATIVE_VERSION = "2.0.24"

export async function connectNativeService(options: NativeRunOptions): Promise<NativeOpenCodeClient> {
  const endpoint = options.attach !== undefined
    ? { url: options.attach, auth: credentialsFromEnvironment() }
    : options.port !== undefined
      ? await connectOrStartAtPort(options.port)
    : await Service.ensure({ version: isSupportedNativeRuntimeVersion })
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    ...(endpoint.auth !== undefined ? { headers: Service.headers(endpoint) } : {}),
  })
  const info = await client.server.info()
  if (!isSupportedNativeRuntimeVersion(info.version)) {
    throw new Error(`OpenCode v2 ${MINIMUM_NATIVE_VERSION}+ is required for the native run command; found ${info.version}`)
  }
  return client
}

async function connectOrStartAtPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be between 1 and 65535")
  const endpoint = { url: `http://127.0.0.1:${port}`, auth: credentialsFromEnvironment() }
  try {
    const client = OpenCode.make({ baseUrl: endpoint.url, ...(endpoint.auth ? { headers: Service.headers(endpoint) } : {}) })
    await client.server.info()
    return endpoint
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  return await Service.ensure({
    version: isSupportedNativeRuntimeVersion,
    command: ["opencode", "serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)],
  })
}

function credentialsFromEnvironment(): { type: "basic"; username: string; password: string } | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (password === undefined || password.length === 0) return undefined
  return { type: "basic", username: process.env.OPENCODE_SERVER_USERNAME ?? "opencode", password }
}
