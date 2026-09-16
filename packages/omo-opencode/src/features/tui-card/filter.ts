export type FilterTexts = readonly string[]

/**
 * Case-insensitive substring match. An empty query passes everything.
 */
export function matchesFilter(query: string, texts: FilterTexts): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return texts.some((value) => value.toLowerCase().includes(needle))
}

export function filterCards<Card>(
  cards: readonly Card[],
  query: string,
  textOf: (card: Card) => FilterTexts,
): Card[] {
  return cards.filter((card) => matchesFilter(query, textOf(card)))
}

export type EscFilterAction = "clear" | "close"

/**
 * First Esc clears a non-empty filter; only an empty filter lets Esc close.
 */
export function escFilterAction(query: string): EscFilterAction {
  return query.trim().length > 0 ? "clear" : "close"
}

export function appendFilterChar(query: string, char: string): string {
  return query + char
}

export function backspaceFilter(query: string): string {
  return query.slice(0, -1)
}

export function filterDisplay(query: string): string {
  if (query.length === 0) return "type to filter"
  return `filter: ${query}_`
}
