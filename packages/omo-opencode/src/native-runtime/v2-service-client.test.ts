import { describe, expect, it } from "bun:test"
import { isSupportedNativeRuntimeVersion } from "./v2-service-client"

describe("native V2 service version", () => {
  it("accepts supported V2 versions and rejects earlier or different major versions", () => {
    expect(isSupportedNativeRuntimeVersion("2.0.24")).toBe(true)
    expect(isSupportedNativeRuntimeVersion("v2.1.0")).toBe(true)
    expect(isSupportedNativeRuntimeVersion("2.0.23")).toBe(false)
    expect(isSupportedNativeRuntimeVersion("3.0.0")).toBe(false)
  })
})
