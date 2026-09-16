export type CardTone = "positive" | "negative" | "warning" | "muted" | "neutral" | "accent"

export type CardBadge = {
  readonly text: string
  readonly tone: CardTone
}

export type CardDescriptor = {
  readonly id: string
  readonly title: string
  readonly badge: CardBadge | undefined
  readonly bodyLines: readonly string[]
  readonly indent: number
}

export type CardGroup = {
  readonly header: string | undefined
  readonly cards: readonly CardDescriptor[]
}

export type CardTheme = {
  readonly primary: unknown
  readonly accent: unknown
  readonly success: unknown
  readonly error: unknown
  readonly warning: unknown
  readonly text: unknown
  readonly textMuted: unknown
  readonly borderActive: unknown
  readonly borderSubtle: unknown
}

export type CardStyle = {
  readonly borderColor: unknown
  readonly titleFg: unknown
  readonly titleBold: boolean
  readonly titleText: string
  readonly badgeFg: unknown
  readonly bodyFg: unknown
}

const FOCUS_INDICATOR = "> "

export function cardStyle(
  card: CardDescriptor,
  focused: boolean,
  theme: CardTheme,
): CardStyle {
  return {
    borderColor: focused ? theme.borderActive : theme.borderSubtle,
    titleFg: focused ? theme.text : theme.textMuted,
    titleBold: focused,
    titleText: `${focused ? FOCUS_INDICATOR : ""}${card.title}`,
    badgeFg: card.badge === undefined ? theme.textMuted : toneColor(card.badge.tone, theme),
    bodyFg: theme.textMuted,
  }
}

export function toneColor(tone: CardTone, theme: CardTheme): unknown {
  switch (tone) {
    case "positive":
      return theme.success
    case "negative":
      return theme.error
    case "warning":
      return theme.warning
    case "muted":
      return theme.textMuted
    case "neutral":
      return theme.text
    case "accent":
      return theme.accent
  }
}
