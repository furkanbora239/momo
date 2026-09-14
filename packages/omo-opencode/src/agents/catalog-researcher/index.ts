import type { AgentConfig } from "@opencode-ai/sdk"
import { catalogResearcherPromptVariants, loadPromptSync } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const CATALOG_RESEARCHER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "CatalogResearcher",
  keyTrigger: "Model missing from static knowledge base needs enrichment",
  triggers: [{ domain: "Catalog enrichment", trigger: "Research unknown model capabilities and pricing" }],
  useWhen: [
    "A connected model has no entry in the static knowledge base",
    "catalog_knowledge reports missing entries for active models",
  ],
  avoidWhen: [
    "Model already has a static profile (use getModelProfile instead)",
    "No curated source is available for the model",
  ],
}

function loadCatalogResearcherPrompt(): string {
  return loadPromptSync({
    source: catalogResearcherPromptVariants.default,
    name: "catalog-researcher",
    variant: "default",
  }).body
}

const CATALOG_RESEARCHER_SYSTEM_PROMPT = loadCatalogResearcherPrompt()

/**
 * Catalog Researcher agent factory.
 *
 * NOT wired into auto-delegation. Invoke explicitly via:
 *   task(subagent_type="catalog-researcher", prompt="Research these models: ...")
 * or register manually in agent config. The agent outputs strict JSON matching
 * ModelKnowledge; pipe the output through catalog_enrich to persist it.
 */
export function createCatalogResearcherAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch"],
    [],
  )

  return {
    description:
      "Research specialist for enriching the model catalog with verified knowledge from curated public sources. Outputs strict JSON with mandatory source URLs. Not auto-delegated; invoke explicitly for unknown models. (CatalogResearcher - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: CATALOG_RESEARCHER_SYSTEM_PROMPT,
  }
}
createCatalogResearcherAgent.mode = MODE
