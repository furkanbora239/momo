import type { CardBadge, CardDescriptor, CardGroup, CardTone } from "../tui-card"
import {
  formatSettingValue,
  SETTINGS_DEFINITIONS,
  settingId,
  type SettingDefinition,
} from "./settings-definitions"
import {
  formatPendingValue,
  serializePendingEditDiffs,
  type PendingEdit,
} from "./pending-edits"

export type CurrentValues = Readonly<Record<string, unknown>>

export type SettingsCard = CardDescriptor & {
  readonly settingKind: "setting" | "apply"
}

const PENDING_BADGE_TEXT = "PENDING EDIT"

export function settingCardBadge(pendingValue: unknown): CardBadge | undefined {
  if (pendingValue === undefined) return undefined
  return { text: PENDING_BADGE_TEXT, tone: "warning" satisfies CardTone }
}

export function buildSettingCard(
  definition: SettingDefinition,
  currentValues: CurrentValues,
  pendingValue: unknown,
): SettingsCard {
  const id = settingId(definition)
  const currentDisplay = formatSettingValue(currentValues[id])
  const bodyLines = [
    definition.hint,
    `current: ${currentDisplay}`,
    ...(pendingValue !== undefined ? [`pending: ${formatPendingValue(pendingValue)}`] : []),
  ]
  return {
    id,
    settingKind: "setting",
    title: definition.label,
    badge: settingCardBadge(pendingValue),
    bodyLines,
    indent: 0,
  }
}

export function buildApplyCard(edits: readonly PendingEdit[]): SettingsCard | undefined {
  if (edits.length === 0) return undefined
  return {
    id: "settings.apply",
    settingKind: "apply",
    title: `apply changes (${edits.length})`,
    badge: { text: "ENTER TO APPLY", tone: "accent" satisfies CardTone },
    bodyLines: serializePendingEditDiffs(edits),
    indent: 0,
  }
}

export function buildSettingsCards(
  currentValues: CurrentValues,
  pendingEdits: readonly PendingEdit[],
  definitions: readonly SettingDefinition[] = SETTINGS_DEFINITIONS,
): SettingsCard[] {
  const pendingById = new Map(pendingEdits.map((edit) => [edit.id, edit.value]))
  const settingCards = definitions.map((definition) =>
    buildSettingCard(definition, currentValues, pendingById.get(settingId(definition)))
  )
  const applyCard = buildApplyCard(pendingEdits)
  return applyCard === undefined ? settingCards : [...settingCards, applyCard]
}

export function settingsFilterTexts(card: SettingsCard): readonly string[] {
  return [card.id, card.title]
}

export function groupSettingCards(cards: readonly SettingsCard[]): CardGroup[] {
  const settings = cards.filter((card) => card.settingKind === "setting")
  const groups: CardGroup[] = settings.length === 0 ? [] : [{ header: undefined, cards: settings }]
  const applyCards = cards.filter((card) => card.settingKind === "apply")
  if (applyCards.length > 0) {
    groups.push({ header: "pending changes", cards: applyCards })
  }
  return groups
}
