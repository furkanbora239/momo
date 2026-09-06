import { describe, expect, it } from "bun:test"
import { extractCavemanPrompt } from "./prompt-trigger"

describe("extractCavemanPrompt", () => {
  it("#given a prompt starting with /caveman #when parsed #then isTriggered is true and prompt is extracted", () => {
    const res = extractCavemanPrompt("/caveman refactor this module into smaller functions")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("refactor this module into smaller functions")
  })

  it("#given a prompt starting with /c #when parsed #then isTriggered is true and prompt is extracted", () => {
    const res = extractCavemanPrompt("/c fix the bug in payment processor")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("fix the bug in payment processor")
  })

  it("#given a prompt starting with /cavemen (typo) #when parsed #then isTriggered is true and prompt is extracted", () => {
    const res = extractCavemanPrompt("/cavemen add unit tests for user service")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("add unit tests for user service")
  })

  it("#given a prompt with colon after /caveman: #when parsed #then isTriggered is true and prompt is extracted", () => {
    const res = extractCavemanPrompt("/caveman: build a fast landing page")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("build a fast landing page")
  })

  it("#given a prompt wrapped in <caveman-prompt> tags #when parsed #then isTriggered is true and inner prompt is extracted", () => {
    const res = extractCavemanPrompt("<caveman-prompt>\nanalyze performance bottlenecks\n</caveman-prompt>")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("analyze performance bottlenecks")
  })

  it("#given a prompt wrapped in <cavemen-prompt> tags #when parsed #then isTriggered is true and inner prompt is extracted", () => {
    const res = extractCavemanPrompt("<cavemen-prompt>optimize sql query</cavemen-prompt>")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("optimize sql query")
  })

  it("#given /caveman with no arguments #when parsed #then isTriggered is true but prompt is empty", () => {
    const res = extractCavemanPrompt("/caveman")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("")
  })

  it("#given /c with only whitespace #when parsed #then isTriggered is true but prompt is empty", () => {
    const res = extractCavemanPrompt("/c   ")
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("")
  })

  it("#given multi-line prompt starting with /caveman\\n #when parsed #then isTriggered is true and full multi-line prompt is preserved", () => {
    const text = "/caveman\nStep 1: check types\nStep 2: run tests"
    const res = extractCavemanPrompt(text)
    expect(res.isTriggered).toBe(true)
    expect(res.prompt).toBe("Step 1: check types\nStep 2: run tests")
  })

  it("#given a non-caveman slash command like /cd or /category #when parsed #then isTriggered is false", () => {
    const res1 = extractCavemanPrompt("/cd /Users/dev/project")
    expect(res1.isTriggered).toBe(false)
    expect(res1.prompt).toBe("/cd /Users/dev/project")

    const res2 = extractCavemanPrompt("/category quick fix typos")
    expect(res2.isTriggered).toBe(false)
    expect(res2.prompt).toBe("/category quick fix typos")

    const res3 = extractCavemanPrompt("/commit and push")
    expect(res3.isTriggered).toBe(false)
    expect(res3.prompt).toBe("/commit and push")
  })

  it("#given regular text without slash command #when parsed #then isTriggered is false and text is preserved", () => {
    const text = "Please explain how React hydration works."
    const res = extractCavemanPrompt(text)
    expect(res.isTriggered).toBe(false)
    expect(res.prompt).toBe(text)
  })
})
