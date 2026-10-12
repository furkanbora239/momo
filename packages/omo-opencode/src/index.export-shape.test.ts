import { describe, expect, it } from "bun:test"
import pluginModule from "./index"

describe("oh-my-openagent native plugin export", () => {
  it("exports the OpenCode v2 plugin definition", () => {
    expect(pluginModule.id).toBe("oh-my-openagent")
    expect(typeof pluginModule.setup).toBe("function")
    expect("server" in pluginModule).toBe(false)
  })
})
