import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test"
import { resolveCategoryExecution } from "./category-resolver"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("catalog model override", () => {
  let connectedProvidersSpy: ReturnType<typeof spyOn> | undefined
  let providerModelsSpy: ReturnType<typeof spyOn> | undefined

  beforeEach(() => {
    mock.restore()
    connectedProvidersSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null)
  })

  afterEach(() => {
    connectedProvidersSpy?.mockRestore()
    providerModelsSpy?.mockRestore()
  })

  const createMockExecutorContext = (): ExecutorContext => ({
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp/test",
    userCategories: {},
    sisyphusJuniorModel: undefined,
  })

  const baseArgs: DelegateTaskArgs = {
    description: "Test task",
    prompt: "Test prompt",
    category: "deep",
    run_in_background: false,
    load_skills: [],
  }

  test("uses catalog-picked model when provided", async () => {
    const args: DelegateTaskArgs = {
      ...baseArgs,
      model: "anthropic/claude-sonnet-4-6",
    }

    const executorCtx = createMockExecutorContext()
    executorCtx.userCategories = {
      deep: {},
    }

    const result = await resolveCategoryExecution(
      args,
      executorCtx,
      undefined,
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
    expect(result.modelInfo?.source).toBe("catalog-pick")
    expect(result.modelInfo?.type).toBe("user-defined")
  })

  test("uses category default when model not provided", async () => {
    const args: DelegateTaskArgs = {
      ...baseArgs,
    }

    const executorCtx = createMockExecutorContext()
    executorCtx.userCategories = {
      deep: {
        model: "anthropic/claude-sonnet-4-6",
      },
    }

    const result = await resolveCategoryExecution(
      args,
      executorCtx,
      undefined,
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
    expect(result.modelInfo?.source).toBe("override")
  })

  test("catalog-picked model takes precedence over category config", async () => {
    const args: DelegateTaskArgs = {
      ...baseArgs,
      model: "openai/gpt-4o",
    }

    const executorCtx = createMockExecutorContext()
    executorCtx.userCategories = {
      deep: {
        model: "anthropic/claude-opus-4",
      },
    }

    const result = await resolveCategoryExecution(
      args,
      executorCtx,
      undefined,
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("openai/gpt-4o")
    expect(result.modelInfo?.source).toBe("catalog-pick")
  })

  test("catalog-picked model takes precedence over sisyphusJuniorModel", async () => {
    const args: DelegateTaskArgs = {
      ...baseArgs,
      model: "openai/gpt-4o-mini",
    }

    const executorCtx = createMockExecutorContext()
    executorCtx.sisyphusJuniorModel = "anthropic/claude-haiku-3.5"
    executorCtx.userCategories = {
      deep: {},
    }

    const result = await resolveCategoryExecution(
      args,
      executorCtx,
      undefined,
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("openai/gpt-4o-mini")
    expect(result.modelInfo?.source).toBe("catalog-pick")
  })

  test("catalog-picked model bypasses hardcoded fallback chain", async () => {
    const args: DelegateTaskArgs = {
      ...baseArgs,
      model: "anthropic/claude-sonnet-4-6",
    }

    const executorCtx = createMockExecutorContext()
    executorCtx.userCategories = {
      deep: {},
    }

    const result = await resolveCategoryExecution(
      args,
      executorCtx,
      undefined,
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("anthropic/claude-sonnet-4-6")
    expect(result.fallbackChain).toBeUndefined()
  })
})
