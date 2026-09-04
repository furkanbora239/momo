import { describe, it, expect } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName, getAgentListDisplayName, normalizeAgentForPrompt, normalizeAgentForPromptKey, stripAgentListSortPrefix } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns display name for lowercase config key (new format)", () => {
    // given config key "sisyphus"
    const configKey = "sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "orchestrator"
    expect(result).toBe("orchestrator")
  })

  it("returns display name for uppercase config key (old format - case-insensitive)", () => {
    // given config key "Sisyphus" (old format)
    const configKey = "Sisyphus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "orchestrator" (case-insensitive lookup)
    expect(result).toBe("orchestrator")
  })

  it("returns original key for unknown agents (fallback)", () => {
    // given config key "custom-agent"
    const configKey = "custom-agent"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "custom-agent" (original key unchanged)
    expect(result).toBe("custom-agent")
  })

  it("returns display name for atlas", () => {
    // given config key "atlas"
    const configKey = "atlas"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

     // then returns "coordinator"
    expect(result).toBe("coordinator")
  })

  it("returns display name for prometheus", () => {
    // given config key "prometheus"
    const configKey = "prometheus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "planner"
    expect(result).toBe("planner")
  })

  it("returns display name for sisyphus-junior", () => {
    // given config key "sisyphus-junior"
    const configKey = "sisyphus-junior"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "worker"
    expect(result).toBe("worker")
  })

  it("returns display name for metis", () => {
    // given config key "metis"
    const configKey = "metis"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "analyst"
    expect(result).toBe("analyst")
  })

  it("returns display name for momus", () => {
    // given config key "momus"
    const configKey = "momus"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

     // then returns "critic"
    expect(result).toBe("critic")
  })

  it("returns display name for oracle", () => {
    // given config key "oracle"
    const configKey = "oracle"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "architect"
    expect(result).toBe("architect")
  })

  it("returns display name for librarian", () => {
    // given config key "librarian"
    const configKey = "librarian"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "librarian"
    expect(result).toBe("librarian")
  })

  it("returns display name for explore", () => {
    // given config key "explore"
    const configKey = "explore"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "explorer"
    expect(result).toBe("explorer")
  })

  it("returns display name for multimodal-looker", () => {
    // given config key "multimodal-looker"
    const configKey = "multimodal-looker"

    // when getAgentDisplayName called
    const result = getAgentDisplayName(configKey)

    // then returns "vision"
    expect(result).toBe("vision")
  })

  it("preserves CJK display-name overrides verbatim", () => {
    expect(getAgentDisplayName("sisyphus", { sisyphus: { displayName: "Sisyphus - 主脑" } })).toBe("Sisyphus - 主脑")
    expect(getAgentDisplayName("hephaestus", { hephaestus: { displayName: "헤파이스토스" } })).toBe("헤파이스토스")
    expect(getAgentDisplayName("atlas", { atlas: { displayName: "アトラス" } })).toBe("アトラス")
  })
})

describe("getAgentConfigKey", () => {
  it("resolves display name to config key", () => {
    // given display name "Sisyphus - ultraworker"
    // when getAgentConfigKey called
    // then returns "sisyphus"
    expect(getAgentConfigKey("Sisyphus - ultraworker")).toBe("sisyphus")
  })

  it("resolves display name case-insensitively", () => {
    // given display name in different case
    // when getAgentConfigKey called
    // then returns "atlas"
    expect(getAgentConfigKey("atlas - plan executor")).toBe("atlas")
  })

  it("resolves legacy parenthesized display names", () => {
    // given legacy parenthesized display name from old configs/sessions
    // when getAgentConfigKey called
    // then resolves to canonical config key
    expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
    expect(getAgentConfigKey("Atlas (Plan Executor)")).toBe("atlas")
  })

  it("passes through lowercase config keys unchanged", () => {
    // given lowercase config key "prometheus"
    // when getAgentConfigKey called
    // then returns "prometheus"
    expect(getAgentConfigKey("prometheus")).toBe("prometheus")
  })

  it("returns lowercased unknown agents", () => {
    // given unknown agent name
    // when getAgentConfigKey called
    // then returns lowercased
    expect(getAgentConfigKey("Custom-Agent")).toBe("custom-agent")
  })

  it("resolves all core agent display names", () => {
    // given all core display names
    // when/then each resolves to its config key
    expect(getAgentConfigKey("Hephaestus - Deep Agent")).toBe("hephaestus")
    expect(getAgentConfigKey("Prometheus - Plan Builder")).toBe("prometheus")
    expect(getAgentConfigKey("Atlas - Plan Executor")).toBe("atlas")
    expect(getAgentConfigKey("Metis - Plan Consultant")).toBe("metis")
    expect(getAgentConfigKey("Momus - Plan Critic")).toBe("momus")
    expect(getAgentConfigKey("Sisyphus-Junior")).toBe("sisyphus-junior")
  })

  it("resolves atlas even when the UI ordering prefix is present", () => {
    expect(getAgentConfigKey(getAgentListDisplayName("atlas"))).toBe("atlas")
  })

  it("resolves display names even when zero-width characters are embedded", () => {
    expect(getAgentConfigKey("Sisyphus\u200B - Ultraworker")).toBe("sisyphus")
    expect(getAgentConfigKey("\uFEFFAtlas - Plan Executor")).toBe("atlas")
  })
})

describe("getAgentListDisplayName", () => {
  it("returns the canonical display name for the core agent list", () => {
    expect(getAgentListDisplayName("sisyphus")).toBe("orchestrator")
    expect(getAgentListDisplayName("hephaestus")).toBe("coder")
    expect(getAgentListDisplayName("prometheus")).toBe("planner")
    expect(getAgentListDisplayName("atlas")).toBe("coordinator")
  })

  it("keeps non-core agents unchanged for list display", () => {
    expect(getAgentListDisplayName("librarian")).toBe("librarian")
  })

  it("is a thin alias for getAgentDisplayName", () => {
    expect(getAgentListDisplayName("sisyphus")).toBe(getAgentDisplayName("sisyphus"))
  })
})

describe("stripAgentListSortPrefix", () => {
  it("strips legacy zero-width sort prefixes baked into v3.14.0–v3.16.0 sessions", () => {
    expect(stripAgentListSortPrefix("\u200B\u200BHephaestus - Deep Agent")).toBe("Hephaestus - Deep Agent")
  })

  it("strips leading and trailing wrapper characters after sort prefix removal", () => {
    expect(stripAgentListSortPrefix("\\Hephaestus - Deep Agent\\")).toBe("Hephaestus - Deep Agent")
  })
})

describe("normalizeAgentForPrompt", () => {
  it("strips core UI ordering prefixes back to canonical display names", () => {
    expect(normalizeAgentForPrompt(getAgentListDisplayName("sisyphus"))).toBe("orchestrator")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("hephaestus"))).toBe("coder")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("prometheus"))).toBe("planner")
    expect(normalizeAgentForPrompt(getAgentListDisplayName("atlas"))).toBe("coordinator")
  })

  it("removes zero-width characters before returning canonical names", () => {
    expect(normalizeAgentForPrompt("Sisyphus\u200B - Ultraworker")).toBe("orchestrator")
  })

  it("converts legacy parenthesized names to canonical display names", () => {
    expect(normalizeAgentForPrompt("Atlas (Plan Executor)")).toBe("coordinator")
  })
})

describe("normalizeAgentForPromptKey", () => {
  it("converts built-in display names to config keys", () => {
    expect(normalizeAgentForPromptKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
  })

  it("strips UI ordering prefixes before returning config keys", () => {
    expect(normalizeAgentForPromptKey(getAgentListDisplayName("atlas"))).toBe("atlas")
  })

  it("preserves custom agents", () => {
    expect(normalizeAgentForPromptKey("MyCustomAgent")).toBe("MyCustomAgent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("contains all expected agent mappings", () => {
    // given expected mappings
    const expectedMappings = {
      sisyphus: "orchestrator",
      hephaestus: "coder",
      prometheus: "planner",
      atlas: "coordinator",
      "sisyphus-junior": "worker",
      metis: "analyst",
      momus: "critic",
      athena: "council",
      "athena-junior": "council-worker",
      oracle: "architect",
      librarian: "librarian",
      explore: "explorer",
      "multimodal-looker": "vision",
      "council-member": "council-member",
    }

    // when checking the constant
    // then contains all expected mappings
    expect(AGENT_DISPLAY_NAMES).toEqual(expectedMappings)
  })

  it("all display names must be HTTP-header-safe (no parentheses)", () => {
    // given all agent display names
    const httpHeaderUnsafe = /[()]/

    // when checking each display name
    for (const [, displayName] of Object.entries(AGENT_DISPLAY_NAMES)) {
      // then none should contain parentheses
      expect(httpHeaderUnsafe.test(displayName)).toBe(false)
    }
  })
})
