import { getAgentConfigKey } from "../../shared/agent-display-names"
import type { NativeOpenCodeClient } from "./types"

export async function resolveNativeAgent(client: NativeOpenCodeClient, requested: string, directory: string): Promise<string> {
  const agents = await client.agent.list({ location: { directory } })
  const exact = agents.data.find((agent) => agent.id === requested)
  if (exact !== undefined) return exact.id
  const canonical = getAgentConfigKey(requested)
  const match = agents.data.find((agent) => getAgentConfigKey(agent.id) === canonical || getAgentConfigKey(agent.name) === canonical)
  if (match !== undefined) return match.id
  throw new Error(`Agent "${requested}" is not available in the connected OpenCode v2 service`)
}
