import { z } from "zod"

const JevCircuitBreakerSchema = z
  .object({
    failures: z
      .number()
      .int()
      .min(1)
      .default(3)
      .describe("Consecutive failures that open the circuit."),
    cooldown_ms: z
      .number()
      .int()
      .min(1000)
      .default(600_000)
      .describe("Cooldown before retrying a tripped circuit (ms)."),
  })
  .describe("Jev circuit breaker tuning.")

const JevBudgetSchema = z
  .object({
    monthly_cap_usd: z
      .number()
      .positive()
      .default(2)
      .describe("Monthly spend cap for Jev decisions (USD)."),
    warn_at_usd: z
      .number()
      .positive()
      .default(1.5)
      .describe("Spend threshold that triggers a warning (USD)."),
  })
  .describe("Jev monthly budget guardrails.")

const JevSettingsSchema = z
  .object({
    model: z.string().min(1).default("jev-1.13-free").describe("Jev model identifier."),
    provider_id: z.string().min(1).default("opencode").describe("OpenCode provider that owns the Jev binding."),
    authentication: z.enum(["provider", "none"]).default("none").describe("Use provider credentials, or explicitly anonymous official free Jev access."),
    base_url: z
      .string()
      .url()
      .default("https://opencode.ai/zen/v1")
      .describe("Jev API base URL."),
    confidence_threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.75)
      .describe("Minimum confidence required to accept a Jev decision."),
    max_attempts: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Maximum Jev decision attempts before fallback."),
    circuit_breaker: JevCircuitBreakerSchema.default(JevCircuitBreakerSchema.parse({})),
    budget: JevBudgetSchema.default(JevBudgetSchema.parse({})),
  })
  .refine(config => config.authentication !== "none" || (config.model === "jev-1.13-free"
    && config.provider_id === "opencode" && config.base_url.replace(/\/+$/, "") === "https://opencode.ai/zen/v1"),
    "Anonymous Jev access requires the official opencode free Jev binding")
  .describe("Jev decision-engine tuning.")

// Normalize legacy partial bindings before validation. Keep the output schema a
// plain object so generated configuration documentation retains every field.
function normalizeJevSettings(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value
  const config = value as Record<string, unknown>
  const official = config.base_url === undefined || typeof config.base_url === "string"
    && config.base_url.replace(/\/+$/, "") === "https://opencode.ai/zen/v1"
  const model = config.model ?? (official && (!config.provider_id || config.provider_id === "opencode")
    && config.authentication !== "provider" ? "jev-1.13-free" : "jev-1.13")
  return { ...config, model,
    provider_id: config.provider_id ?? (model === "jev-1.13-free" ? "opencode" : "opencode-go"),
    authentication: config.authentication ?? (model === "jev-1.13-free" ? "none" : "provider"),
  }
}

const JevConfigSchema = z.preprocess(normalizeJevSettings, JevSettingsSchema)
  .describe("Jev decision-engine tuning.")

// Configuration for the manager decision engine. momo is replacing its LLM
// "manager" triage agent with a Jev (TypeSafe System One) decision engine; this
// block is the config switch that selects the engine and tunes its behavior.
// No task() wiring lives here yet — that is a later PR.
export const ManagerConfigSchema = z
  .object({
    decision_engine: z
      .enum(["jev", "heuristic", "llm"])
      .default("jev")
      .describe("Routing decision engine: jev (TypeSafe System One), heuristic, or llm."),
    advisor_models: z.array(z.object({ providerID: z.string().min(1), id: z.string().min(1) })).default([])
      .describe("Explicit connected model pool for momo_consult. Empty disables consultations."),
    jev: JevConfigSchema.default(JevConfigSchema.parse({})),
  })
  .describe("Manager decision-engine configuration (routing/triage).")

export type ManagerConfig = z.infer<typeof ManagerConfigSchema>
