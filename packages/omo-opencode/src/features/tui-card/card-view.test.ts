import { describe, expect, it } from "bun:test"

import { cardStyle, type CardTheme } from "./card-view"

const theme: CardTheme = {
  primary: "primary",
  accent: "accent",
  success: "success",
  error: "error",
  warning: "warning",
  text: "text",
  textMuted: "muted",
  borderActive: "border-active",
  borderSubtle: "border-subtle",
}

function card(id: string): Parameters<typeof cardStyle>[0] {
  return {
    id,
    title: id,
    badge: { text: "ALLOWED", tone: "positive" },
    bodyLines: ["in $1.00 / out $2.00 per M"],
    indent: 0,
  }
}

describe("cardStyle", () => {
  it("#given a focused card #when styling #then it uses the active border and a focus indicator", () => {
    const style = cardStyle(card("a"), true, theme)
    expect(style.borderColor).toBe("border-active")
    expect(style.titleFg).toBe("text")
    expect(style.titleBold).toBe(true)
    expect(style.titleText.startsWith("> ")).toBe(true)
  })

  it("#given an unfocused card #when styling #then it is dim without an indicator", () => {
    const style = cardStyle(card("a"), false, theme)
    expect(style.borderColor).toBe("border-subtle")
    expect(style.titleFg).toBe("muted")
    expect(style.titleBold).toBe(false)
    expect(style.titleText).toBe("a")
  })

  it("#given a card without a badge #when styling #then the badge falls back to muted", () => {
    const bare = { ...card("a"), badge: undefined }
    const style = cardStyle(bare, false, theme)
    expect(style.badgeFg).toBe("muted")
  })

  it("#given badge tones #when styling #then each tone resolves to its theme color", () => {
    const positive = cardStyle({ ...card("a"), badge: { text: "x", tone: "positive" } }, false, theme)
    expect(positive.badgeFg).toBe("success")
    const negative = cardStyle({ ...card("a"), badge: { text: "x", tone: "negative" } }, false, theme)
    expect(negative.badgeFg).toBe("error")
    const accent = cardStyle({ ...card("a"), badge: { text: "x", tone: "accent" } }, false, theme)
    expect(accent.badgeFg).toBe("accent")
  })
})
