import { describe, expect, it } from "bun:test"

import {
  addPendingEdit,
  serializePendingEditDiffs,
  type PendingEdit,
} from "./pending-edits"
import {
  buildApplyCard,
  buildSettingCard,
  buildSettingsCards,
  groupSettingCards,
  settingsFilterTexts,
} from "./settings-cards"
import { SETTINGS_DEFINITIONS, settingId } from "./settings-definitions"

const edit = (id: string, path: readonly (string | number)[], value: unknown, currentLabel: string): PendingEdit => ({
  id,
  path,
  value,
  currentLabel,
})

const firstDefinition = SETTINGS_DEFINITIONS[0]
if (firstDefinition === undefined) throw new Error("definitions required")

describe("buildSettingCard", () => {
  it("#given a present current value and no pending edit #when built #then the badge is absent and the body shows the current value", () => {
    const card = buildSettingCard(firstDefinition, { [settingId(firstDefinition)]: false }, undefined)
    expect(card.badge).toBeUndefined()
    expect(card.bodyLines.some((line) => line.includes("current: false"))).toBe(true)
    expect(card.settingKind).toBe("setting")
  })

  it("#given a missing current value #when built #then the body labels the default", () => {
    const card = buildSettingCard(firstDefinition, {}, undefined)
    expect(card.bodyLines.some((line) => line === "current: (default)")).toBe(true)
  })

  it("#given a pending edit #when built #then the card is badged and the body shows the pending value", () => {
    const card = buildSettingCard(firstDefinition, {}, true)
    expect(card.badge).toEqual({ text: "PENDING EDIT", tone: "warning" })
    expect(card.bodyLines.some((line) => line === "pending: true")).toBe(true)
  })
})

describe("buildApplyCard", () => {
  const edits = addPendingEdit([], {
    id: "catalog.enabled",
    path: ["catalog", "enabled"],
    value: false,
    current: { present: true, value: true },
    defaultLabel: "(default)",
  })

  it("#given zero edits #when built #then no apply card exists", () => {
    expect(buildApplyCard([])).toBeUndefined()
  })

  it("#given pending edits #when built #then the title counts them and the body carries the diff lines", () => {
    const card = buildApplyCard(edits)
    if (card === undefined) throw new Error("apply card expected")
    expect(card.settingKind).toBe("apply")
    expect(card.title).toBe("apply changes (1)")
    expect(card.bodyLines).toEqual(serializePendingEditDiffs(edits))
  })
})

describe("buildSettingsCards", () => {
  it("#given no pending edits #when built #then only setting cards are rendered", () => {
    const cards = buildSettingsCards({}, [])
    expect(cards.every((card) => card.settingKind === "setting")).toBe(true)
    expect(cards).toHaveLength(SETTINGS_DEFINITIONS.length)
  })

  it("#given pending edits #when built #then the apply card trails the setting cards", () => {
    const cards = buildSettingsCards({}, [edit("a.b", ["a", "b"], 1, "(default)")])
    expect(cards[cards.length - 1]?.settingKind).toBe("apply")
  })
})

describe("groupSettingCards", () => {
  it("#given only setting cards #when grouped #then there is one unheaded group", () => {
    const groups = groupSettingCards(buildSettingsCards({}, []))
    expect(groups).toHaveLength(1)
    expect(groups[0]?.header).toBeUndefined()
  })

  it("#given an apply card #when grouped #then the pending changes group follows", () => {
    const groups = groupSettingCards(buildSettingsCards({}, [edit("a.b", ["a", "b"], 1, "(default)")]))
    expect(groups).toHaveLength(2)
    expect(groups[1]?.header).toBe("pending changes")
    expect(groups[1]?.cards).toHaveLength(1)
  })
})

describe("settingsFilterTexts", () => {
  it("#given a card #when filtered #then id and title are searchable", () => {
    const card = buildSettingCard(firstDefinition, {}, undefined)
    expect(settingsFilterTexts(card)).toEqual([card.id, card.title])
  })
})
