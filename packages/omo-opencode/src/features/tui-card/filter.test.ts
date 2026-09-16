import { describe, expect, it } from "bun:test"

import {
  appendFilterChar,
  backspaceFilter,
  escFilterAction,
  filterCards,
  filterDisplay,
  matchesFilter,
} from "./filter"

type Item = { readonly id: string; readonly label: string }

const items: readonly Item[] = [
  { id: "1", label: "neuralwatt/glm-5.2" },
  { id: "2", label: "NeuralWatt/Kimi-K3" },
  { id: "3", label: "google/gemini-3-flash" },
]

const textOf = (item: Item): readonly string[] => [item.label]

describe("matchesFilter", () => {
  it("#given an empty query #when matching #then everything passes", () => {
    expect(matchesFilter("", ["anything"])).toBe(true)
    expect(matchesFilter("   ", ["anything"])).toBe(true)
  })

  it("#given a substring #when matching #then it matches case-insensitively", () => {
    expect(matchesFilter("KIMI", ["NeuralWatt/Kimi-K3"])).toBe(true)
    expect(matchesFilter("kimi", ["neuralwatt/glm-5.2"])).toBe(false)
  })

  it("#given any haystack #when one text matches #then it passes", () => {
    expect(matchesFilter("flash", ["google", "gemini-3-flash"])).toBe(true)
    expect(matchesFilter("zzz", ["google", "gemini-3-flash"])).toBe(false)
  })
})

describe("filterCards", () => {
  it("#given an empty query #when filtering #then the order is preserved", () => {
    expect(filterCards(items, "", textOf).map((item) => item.id)).toEqual(["1", "2", "3"])
  })

  it("#given a query #when filtering #then only matching cards remain in order", () => {
    expect(filterCards(items, "neuralwatt", textOf).map((item) => item.id)).toEqual(["1", "2"])
  })

  it("#given a query with no matches #when filtering #then the list is empty", () => {
    expect(filterCards(items, "zzz", textOf)).toEqual([])
  })
})

describe("escFilterAction", () => {
  it("#given a non-empty query #when pressing esc #then it clears the filter first", () => {
    expect(escFilterAction("glm")).toBe("clear")
  })

  it("#given an empty query #when pressing esc #then it closes the dialog", () => {
    expect(escFilterAction("")).toBe("close")
    expect(escFilterAction("   ")).toBe("close")
  })
})

describe("appendFilterChar and backspaceFilter", () => {
  it("#given a query #when appending #then the char is added", () => {
    expect(appendFilterChar("gl", "m")).toBe("glm")
  })

  it("#given a query #when backspacing #then the last char is removed", () => {
    expect(backspaceFilter("glm")).toBe("gl")
  })

  it("#given an empty query #when backspacing #then it stays empty", () => {
    expect(backspaceFilter("")).toBe("")
  })
})

describe("filterDisplay", () => {
  it("#given an empty query #when rendering #then it shows the hint", () => {
    expect(filterDisplay("")).toBe("type to filter")
  })

  it("#given a query #when rendering #then it shows the query with a cursor", () => {
    expect(filterDisplay("glm").startsWith("filter: glm")).toBe(true)
    expect(filterDisplay("glm").endsWith("_")).toBe(true)
  })
})
