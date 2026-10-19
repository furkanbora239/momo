// MODIFIED: momo task types are configurable catalog classes, independent of native roles.
import { z } from "zod"
import type { JobClassDefinitions } from "./job-classification-types"

export const JobClassesSchema = z.array(z.object({
  id: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(512),
})).min(1).max(32).refine((classes) => new Set(classes.map((entry) => entry.id)).size === classes.length,
  "Job class identifiers must be unique")

export const DEFAULT_JOB_CLASSES = [
  { id: "coding", description: "Implement, debug, test or review software." },
  { id: "research", description: "Find, verify and synthesize information from sources." },
  { id: "planning", description: "Plan work, architecture, dependencies and acceptance criteria." },
  { id: "analysis", description: "Analyze data, evidence or complex problems and draw conclusions." },
  { id: "writing", description: "Write, edit, translate or summarize natural language." },
  { id: "visual", description: "Interpret images or reason about visual design and interfaces." },
] as const

export function createJobClassDefinitions(classes: unknown = DEFAULT_JOB_CLASSES): JobClassDefinitions {
  return { version: "job-types-v1", classifierVersion: "source-suitability-v1", classes: JobClassesSchema.parse(classes) }
}
