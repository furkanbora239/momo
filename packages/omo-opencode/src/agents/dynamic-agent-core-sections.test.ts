import { describe, expect, it } from "bun:test"
import {
  buildPonytailLadderSection,
  buildOracleSection,
  buildExploreSection,
} from "./dynamic-agent-core-sections"

describe("dynamic-agent-core-sections", () => {
  describe("buildPonytailLadderSection", () => {
    it("returns a non-empty string", () => {
      expect(buildPonytailLadderSection().length).toBeGreaterThan(0)
    })
    it("contains the ponytail_ladder tag", () => {
      expect(buildPonytailLadderSection()).toContain("ponytail_ladder")
    })
    it("contains the ladder rungs", () => {
      const result = buildPonytailLadderSection()
      expect(result).toContain("YAGNI")
      expect(result).toContain("Stdlib")
    })
  })

  describe("buildOracleSection", () => {
    it("returns empty string when no oracle agent present", () => {
      expect(buildOracleSection([])).toBe("")
    })
  })

  describe("buildExploreSection", () => {
    it("returns empty string when no explore agent present", () => {
      expect(buildExploreSection([])).toBe("")
    })
  })
})
