const { describe, test, expect } = require("bun:test")

const { DelegationConfigSchema } = require("./delegation")

describe("delegation config gate", () => {
  test("#given empty config #when parsed #then managers defaults to true", () => {
    const result = DelegationConfigSchema.parse({})
    expect(result.managers).toBe(true)
  })

  test("#given managers=false #when parsed #then managers is false", () => {
    const result = DelegationConfigSchema.parse({ managers: false })
    expect(result.managers).toBe(false)
  })

  test("#given managers=true #when parsed #then managers is true", () => {
    const result = DelegationConfigSchema.parse({ managers: true })
    expect(result.managers).toBe(true)
  })
})

module.exports = {}
