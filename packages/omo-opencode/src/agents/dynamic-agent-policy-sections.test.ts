import { describe, expect, it } from "bun:test"
import {
  buildAntiDuplicationSection,
  buildToolCallFormatSection,
} from "./dynamic-agent-policy-sections"

describe("dynamic-agent-policy-sections", () => {
  describe("buildAntiDuplicationSection", () => {
    it("returns a non-empty string", () => {
      expect(buildAntiDuplicationSection().length).toBeGreaterThan(0)
    })
    it("contains the Anti_Duplication tag", () => {
      expect(buildAntiDuplicationSection()).toContain("Anti_Duplication")
    })
    it("forbids re-searching while waiting for delegated results", () => {
      expect(buildAntiDuplicationSection()).toContain("background_output")
    })
  })

  describe("buildToolCallFormatSection", () => {
    it("forbids text tool calls", () => {
      expect(buildToolCallFormatSection()).toContain("native tool calling")
    })
  })
})
