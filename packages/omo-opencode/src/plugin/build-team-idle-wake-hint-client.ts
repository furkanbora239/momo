import type { PluginContext } from "./types"


type SdkSession = PluginContext["client"]["session"]
type SdkPromptAsync = SdkSession["promptAsync"]
type SdkStatus = SdkSession["status"]
type SdkMessages = SdkSession["messages"]

export type TeamIdleWakeHintNarrowClient = {
  session: {
    promptAsync?: SdkPromptAsync
    status?: SdkStatus
    messages?: SdkMessages
  }
}

export function buildTeamIdleWakeHintClient(client: PluginContext["client"]): TeamIdleWakeHintNarrowClient {
  const session = client.session
  const promptAsync = typeof session.promptAsync === "function"
    ? session.promptAsync.bind(session) as SdkPromptAsync
    : undefined
  const status = typeof session.status === "function"
    ? session.status.bind(session) as SdkStatus
    : undefined
  const messages = typeof session.messages === "function"
    ? session.messages.bind(session) as SdkMessages
    : undefined
  return {
    session: { promptAsync, status, messages },
  }
}
