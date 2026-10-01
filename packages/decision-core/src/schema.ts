import type {
  ChoiceQuestion,
  ModelCandidate,
  PathOption,
  ScoreQuestion,
} from "./types"

export function buildPathQuestion(
  pathOptions: readonly PathOption[],
): ChoiceQuestion {
  const criteria: Record<string, string> = {}
  for (const option of pathOptions) {
    criteria[option.name] = option.description
  }
  return {
    type: "choice",
    instructions: "Which execution lane fits this task best?",
    criteria,
  }
}

export function buildEffortQuestion(): ScoreQuestion {
  return {
    type: "score",
    instructions: "How demanding is this task?",
    criteria: [
      "1 - trivial",
      "2 - small",
      "3 - moderate",
      "4 - large",
      "5 - very hard",
    ],
  }
}

export function buildModelQuestion(
  candidates: readonly ModelCandidate[],
): ChoiceQuestion {
  const criteria: Record<string, string> = {}
  for (const candidate of candidates) {
    criteria[candidate.name] = `${candidate.priceLine}; ${candidate.strength}`
  }
  return {
    type: "choice",
    instructions:
      "Pick the cheapest model that is adequate for this task given its difficulty; prefer premium only when truly needed.",
    criteria,
  }
}

export function buildLaneQuestion(): ChoiceQuestion {
  return {
    type: "choice",
    instructions: "How should this task be organized for execution?",
    criteria: {
      "direct-worker":
        "single worker handles the whole task",
      department:
        "task is large enough to warrant a department lead coordinating multiple workers",
    },
  }
}
