import { createSisyphusAgent } from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/agents/sisyphus-agent-factory"

const agents = [
  {
    name: "explore",
    description: "Contextual grep over the codebase.",
    metadata: {
      cost: "CHEAP",
      category: "research",
      keyTrigger: "codebase search",
      triggers: [{ domain: "search", trigger: "find code" }],
      useWhen: ["unknown file location", "pattern discovery"],
      avoidWhen: ["known file path"],
    },
  },
  {
    name: "librarian",
    description: "External reference search.",
    metadata: {
      cost: "CHEAP",
      category: "research",
      keyTrigger: "external docs",
      triggers: [{ domain: "docs", trigger: "API docs" }],
      useWhen: ["unfamiliar library", "external API"],
      avoidWhen: [],
    },
  },
  {
    name: "oracle",
    description: "Read-only expensive consultant.",
    metadata: {
      cost: "EXPENSIVE",
      category: "consultant",
      keyTrigger: "architecture decision",
      triggers: [{ domain: "architecture", trigger: "complex design" }],
      useWhen: ["architecture risk", "subtle debugging"],
      avoidWhen: ["trivial change"],
    },
  },
]

const config = createSisyphusAgent("deepseek-chat", agents, [], [], [], false)
const prompt = config.prompt ?? ""
console.log(prompt)
