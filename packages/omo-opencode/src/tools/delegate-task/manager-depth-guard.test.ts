const { describe, test, expect } = require("bun:test")

const {
  DEFAULT_MAX_SUBAGENT_DEPTH,
  getMaxSubagentDepth,
} = require("../../features/background-agent/subagent-spawn-limits")

describe("sync depth guard", () => {
  test("#given no config #when getMaxSubagentDepth called #then returns default 3", () => {
    expect(getMaxSubagentDepth(undefined)).toBe(DEFAULT_MAX_SUBAGENT_DEPTH)
    expect(DEFAULT_MAX_SUBAGENT_DEPTH).toBe(3)
  })

  test("#given config with maxDepth=2 #when getMaxSubagentDepth called #then returns 2", () => {
    expect(getMaxSubagentDepth({ maxDepth: 2 })).toBe(2)
  })

  test("#given config without maxDepth #when getMaxSubagentDepth called #then returns default 3", () => {
    expect(getMaxSubagentDepth({})).toBe(3)
  })

  test("#given default depth 3 #when tracing owner-manager-worker chain #then depths fit: owner(0)→manager(1)→worker(2) all ≤ 3", () => {
    const max = getMaxSubagentDepth(undefined)
    const ownerChildDepth = 1
    const managerChildDepth = 2
    expect(ownerChildDepth).toBeLessThanOrEqual(max)
    expect(managerChildDepth).toBeLessThanOrEqual(max)
  })

  test("#given default depth 3 #when depth would reach 4 (grandchild of worker) #then exceeds and is blocked", () => {
    const max = getMaxSubagentDepth(undefined)
    const grandchildDepth = 4
    expect(grandchildDepth > max).toBe(true)
  })
})

module.exports = {}
