import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import {
  clearSessionAdvisorBinding,
  getSessionAdvisorBinding,
  resolveAdvisorModel,
  setSessionAdvisorBinding,
} from "../../agents/advisor-binding"

export interface AdvisorToolOptions {
  /** Persistent config binding (agents.advisor.model), shown in reports. */
  configModel?: string
}

const ADVISOR_TOOL_DESCRIPTION = `Bind, unbind, or report the momo advisor model for THIS session.
The advisor is a bound-on-demand senior model. It stays UNBOUND (delegation to it is rejected) until a model is bound here or via agents.advisor.model config.
Actions: "report" (default) shows the current binding and its source; "bind" requires the model parameter (e.g. "neuralwatt/glm-5.2") and applies only to this session; "off" clears the session binding (a config binding, if any, still applies).`

export function createAdvisorTool(options: AdvisorToolOptions = {}): ToolDefinition {
  return tool({
    description: ADVISOR_TOOL_DESCRIPTION,
    args: {
      action: tool.schema
        .enum(["bind", "off", "report"])
        .optional()
        .describe('Action to perform. Default: "report".'),
      model: tool.schema
        .string()
        .optional()
        .describe('Model id to bind (provider/model, e.g. "neuralwatt/glm-5.2"). Required for action="bind".'),
    },
    async execute(args, toolContext) {
      const sessionID = (toolContext as { sessionID?: string }).sessionID
      if (!sessionID) {
        return "advisor: cannot determine the current session id; binding not changed."
      }

      const action = args.action ?? (args.model ? "bind" : "report")

      if (action === "bind") {
        const model = args.model?.trim()
        if (!model) {
          return 'advisor: action "bind" requires the model parameter (e.g. model="neuralwatt/glm-5.2").'
        }
        setSessionAdvisorBinding(sessionID, model)
        return `advisor: bound to "${model}" for this session. Delegation to the advisor agent is now enabled and will use this model. Use action="off" to unbind.`
      }

      if (action === "off") {
        clearSessionAdvisorBinding(sessionID)
        if (options.configModel) {
          return `advisor: session binding cleared. The config binding "${options.configModel}" (agents.advisor.model) still applies.`
        }
        return "advisor: session binding cleared. The advisor is now UNBOUND; delegation to it will be rejected."
      }

      const sessionModel = getSessionAdvisorBinding(sessionID)
      const effective = resolveAdvisorModel({ configModel: options.configModel, sessionModel })
      if (!effective) {
        return 'advisor: UNBOUND. No session binding and no agents.advisor.model config. Bind one with the advisor tool (action="bind", model="<provider/model>") or set agents.advisor.model in ~/.omo/omo.jsonc.'
      }
      const source = sessionModel ? "session binding (this session only)" : "config binding (agents.advisor.model)"
      return `advisor: bound to "${effective}" via ${source}.`
    },
  })
}
