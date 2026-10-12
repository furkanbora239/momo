import { afterEach, describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"
import {
  clearSisyphusRuntimePromptContext,
  reconcileSisyphusRuntimePrompt,
  setSisyphusRuntimePromptContext,
} from "../agents/sisyphus-runtime-prompt-reconciler"

const configuredModel = "provider/configured"
const runtimeModel = "provider/runtime"
const registeredBody = "registered-body"
const runtimeBody = "runtime-body"

afterEach(() => {
  clearSisyphusRuntimePromptContext()
})

describe("runtime model prompt reconciliation", () => {
  test("replaces only the registered body and preserves surrounding system content", async () => {
    setSisyphusRuntimePromptContext({
      configuredModel,
      bakedPrompt: registeredBody,
      rebuildPromptForModel: (model) => model === runtimeModel ? runtimeBody : "other-body",
    })
    const handler = createSystemTransformHandler()
    const output = { system: [`prefix ${registeredBody} suffix`] }

    await handler(
      { sessionID: "s", model: { id: runtimeModel, providerID: "provider" } },
      output,
    )

    expect(output.system).toEqual([`prefix ${runtimeBody} suffix`])
  })

  test("does not alter a system prompt when the registered model is already active", async () => {
    setSisyphusRuntimePromptContext({
      configuredModel,
      bakedPrompt: registeredBody,
      rebuildPromptForModel: () => runtimeBody,
    })
    const output = { system: [registeredBody] }
    await createSystemTransformHandler()(
      { sessionID: "s", model: { id: "configured", providerID: "provider" } },
      output,
    )
    expect(output.system).toEqual([registeredBody])
  })
})
