import type { PluginContext } from "../../plugin/types"


export type Client = PluginContext["client"] & {
  session: {
    promptAsync: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (opts: {
      body: {
        title: string
        message: string
        variant: string
        duration: number
      }
    }) => Promise<unknown>
  }
}
