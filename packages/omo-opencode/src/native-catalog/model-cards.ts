import { z } from "zod"
import bundledCatalog from "../../assets/model-catalog.json"
import type { NativeKnowledgeFact, NativeModelRef } from "../native-routing/types"

const identity = z.string().min(1).max(256).refine((value) => value === value.trim() && !/\s/.test(value), "model identity must be exact and contain no whitespace")
const text = z.string().trim().min(1).max(2400)
const source = z.string().url().refine((value) => {
  const url = new URL(value)
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    ![...url.searchParams.keys()].some((key) => /(?:^|[-_])(?:api[-_]?key|key|token|access[-_]?token|auth(?:orization)?|password|secret|signature|credential)(?:$|[-_])/i.test(key))
}, "source must be an HTTP(S) URL without credentials or authentication query parameters")

export const ModelCardSchema = z.object({
  canonical: identity,
  aliases: z.array(identity).max(64),
  summary: text,
  strengths: z.array(text).max(24),
  limitations: z.array(text).max(24),
  sources: z.array(source).min(1).max(16),
  researchedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((card, context) => {
  const keys = [card.canonical, ...card.aliases]
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["aliases"], message: "duplicate model identity" })
})

export const ModelCatalogSchema = z.object({
  version: z.literal(1),
  models: z.array(ModelCardSchema).max(10000),
}).strict().superRefine((catalog, context) => {
  const identities = new Set<string>()
  for (const [index, card] of catalog.models.entries()) {
    for (const key of [card.canonical, ...card.aliases]) {
      if (identities.has(key)) context.addIssue({ code: "custom", path: ["models", index], message: `ambiguous model identity: ${key}` })
      identities.add(key)
    }
  }
})

export const SharedModelCatalogSchema = ModelCatalogSchema
export type ModelCard = z.infer<typeof ModelCardSchema>
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>
export function parseModelCatalog(value: unknown): ModelCatalog { return ModelCatalogSchema.parse(value) }

const cards = parseModelCatalog(bundledCatalog)
const byIdentity = new Map(cards.models.flatMap((card) => [card.canonical, ...card.aliases].map((key) => [key, card] as const)))

export function readBundledModelKnowledge(
  model: NativeModelRef,
  identity?: { canonical?: string; transportID?: string },
): NativeKnowledgeFact | undefined {
  const canonical = identity?.canonical
  const authoritative = canonical ? byIdentity.get(canonical) : undefined
  // An explicit identity must never borrow a different model's alias card.
  if (canonical && !authoritative) return undefined
  const matches = [model.id, identity?.transportID].flatMap((key) => {
    const card = key ? byIdentity.get(key) : undefined
    return card ? [card] : []
  })
  const candidates = new Set([...(authoritative ? [authoritative] : []), ...matches])
  if (candidates.size !== 1) return undefined
  const card = [...candidates][0]
  return {
    model, known: true, summary: card.summary, strengths: [...card.strengths], limitations: [...card.limitations],
    source: card.sources.join(", "), verifiedAt: card.researchedAt,
  }
}
