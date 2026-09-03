# Momo Reference Deployment Profile

This document specifies the recommended multi-provider deployment profile optimized for **momo (My Oh My Openagent)**.

## Architectural North Star

momo is built around high-throughput, low-cost model execution:
1. **Orchestrator** operates with maximum prompt caching and minimal output tokens.
2. **Manager (Dispatcher)** routes incoming tasks to specialized leads without doing code edits.
3. **Leads (Planner & Executor)** break tasks into atomic units and dynamically query the Model Catalog MCP (`catalog_pick`) to assign workers.
4. **Workers** run exclusively on ultra-cheap, high-throughput models and report directly back.

---

## Hardware & Subscription Setup

| Role | Target Provider | Recommended Model | Rationale |
|---|---|---|---|
| **Orchestrator (Sisyphus)** | `neuralwatt` | `neuralwatt/glm-5.2` / `kimi-k3` / `claude-opus` | Takes advantage of **Neuralwatt Prompt Caching**; context stays cheap across long sessions. |
| **Manager (Dispatcher)** | `opencode-go` (`go-b`) | `go-b/qwen3.8-flash` | Ultra-fast (low TTFT), sharp routing, highly cost-effective under Go 6x campaign. |
| **Leads (Planner & Executor)** | `opencode-go` (`go-b`) | `go-b/glm-5.3-flash` / `qwen3.7-plus` | Strong reasoning for decomposition and test verification without draining limits. |
| **Workers (Coding & Explore)** | `opencode-go` (`go-b`) | `go-b/hy3`, `deepseek-v4-flash`, `glm-5.3-flash` | High throughput coding (`hy3`) and rapid codebase exploration (`deepseek-flash`). |
| **Cloud Translator** | `google` | `google/gemma-4-31b-it` / Gemini Flash | Free Google AI Studio API key; zero-cost local translation. |

---

## 3-Level Delegation Hierarchy

```
[Orchestrator: Neuralwatt]
       │
       ▼ (task)
[Manager: Qwen 3.8 Flash (Go)]
       │
       ▼ (catalog_pick -> model)
[Department Lead: Planner or Executor (Go)]
       │
       ▼ (catalog_pick per atomic task)
[Workers: HY3 / DeepSeek Flash (Go)]
       │
       └─► (Direct Return with clean summary to Orchestrator)
```

### Delegation Rules
1. **Orchestrator Direct Edits**: Trivial 1-2 line edits (typos, formatting, single imports) are handled directly by the Orchestrator with `replace_file_content`. Substantive work is delegated to `manager`.
2. **Manager Dispatching**: The Manager evaluates task scope, selects the appropriate lead (`planner` or `executor`), picks the lead model via `catalog_pick`, and launches the lead.
3. **Dynamic Worker Selection**: Leads inspect each atomic sub-step and call `catalog_pick(need, budget_profile="low_cost")` to select the right worker model (`hy3`, `deepseek-v4-flash`, `glm-5.3-flash`).
4. **Direct Delivery**: When the lead finishes executing or planning, it returns the verified result directly to the Orchestrator. The Manager does not re-narrate or bloat the return path.
