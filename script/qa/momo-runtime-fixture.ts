// Isolated QA entry only. Runtime activation is delivered separately.
import { Plugin } from "../../packages/omo-opencode/node_modules/@opencode/plugin/dist/promise/index.js"
import { installOwnedAgents } from "../../packages/omo-opencode/src/native-runtime/agents/owned-agents"
import { registerNativePermissions } from "../../packages/omo-opencode/src/native-runtime/permission-policy"
import { nativeAgentPermissions } from "../../packages/omo-opencode/src/native-runtime/role-policy"
import { ownedAgentID } from "../../packages/omo-opencode/src/native-runtime/role-policy"
import { registerNativeTools } from "../../packages/omo-opencode/src/native-runtime/task-tools"

export const omoPlugin = Plugin.define({
  id: "oh-my-openagent",
  async setup(ctx) {
    const agents = installOwnedAgents()
    const activeOwnedIDs = new Set(agents.owned)
    await ctx.agent.reload()
    await ctx.agent.transform((editor) => {
      for (const id of agents.owned) {
        const agent = editor.get(id)
        const role = ownedAgentID(id)
        if (agent && role) editor.update(id, (value) => { value.permissions = nativeAgentPermissions(role) })
      }
      if (agents.owned.includes("momo-orchestrator")) editor.default("momo-orchestrator")
    })
    const disposePermissions = await registerNativePermissions(ctx, activeOwnedIDs)
    const native = await registerNativeTools(ctx, activeOwnedIDs)
    if (agents.conflicts.length > 0) console.warn("momo native agent file conflicts", agents.conflicts)
    return async () => {
      await native.dispose()
      await disposePermissions()
    }
  },
})

export default omoPlugin

