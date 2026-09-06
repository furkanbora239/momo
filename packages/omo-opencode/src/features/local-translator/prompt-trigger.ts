export interface CavemanExtraction {
  readonly isTriggered: boolean
  readonly prompt: string
}

const CAVEMAN_TAG_REGEX = /<(?:caveman|cavemen|c)-prompt>([\s\S]*?)<\/(?:caveman|cavemen|c)-prompt>/i
const CAVEMAN_PREFIX_REGEX = /^\/(?:caveman|cavemen|c)(?:[:\s]+([\s\S]*))?$/i

export function extractCavemanPrompt(text: string): CavemanExtraction {
  const trimmed = text.trim()

  const tagMatch = trimmed.match(CAVEMAN_TAG_REGEX)
  if (tagMatch) {
    return {
      isTriggered: true,
      prompt: tagMatch[1]?.trim() ?? "",
    }
  }

  const prefixMatch = trimmed.match(CAVEMAN_PREFIX_REGEX)
  if (prefixMatch) {
    return {
      isTriggered: true,
      prompt: prefixMatch[1]?.trim() ?? "",
    }
  }

  return {
    isTriggered: false,
    prompt: text,
  }
}
