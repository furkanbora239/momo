export type NativeTaskKind = "task" | "consultation"
export type NativeTaskState =
  | "awaiting_selection"
  | "queued"
  | "running"
  | "waiting_question"
  | "waiting_children"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"

export type NativeTaskRole =
  | "orchestrator"
  | "planner"
  | "executor"
  | "reviewer"
  | "worker"
  | "explore"
  | "librarian"
  | "research"
  | "catalog-researcher"
  | "advisor"

export type NativeModelRef = { providerID: string; id: string }
export type NativeCandidate = {
  role: NativeTaskRole
  model: NativeModelRef
  facts?: unknown
  knowledge?: unknown
  probability?: number
  rationale?: string
}

export type NativeRouteInput = {
  decisionId?: string
  prompt: string
  scope?: string
  acceptance?: string
  parentRole: NativeTaskRole
  requiredRole?: NativeTaskRole
  sourceDecisionID?: string
  rootSessionID: string
  parentSessionID: string
  kind: NativeTaskKind
}

export type NativeRouteResult =
  | { kind: "selected"; decisionId: string; role: NativeTaskRole; model: NativeModelRef }
  | { kind: "awaiting_selection"; decisionId: string; reason: string; candidates: readonly NativeCandidate[] }
  | { kind: "unavailable"; reason: string }

export type NativeTaskRouter = {
  route(input: NativeRouteInput): Promise<NativeRouteResult>
  bindResearch?(input: NativeRouteInput, model: NativeModelRef): Promise<NativeRouteResult>
  select(
    decisionId: string,
    model: NativeModelRef,
    role: NativeTaskRole,
    callerSessionID: string,
  ): Promise<NativeRouteResult>
  revalidateSelected?(decisionId: string, callerSessionID: string): Promise<NativeRouteResult>
  recordDispatch?(decisionId: string, dispatch: { taskId: string; sessionId: string; role: NativeTaskRole; model: NativeModelRef }, callerSessionID: string): Promise<void>
  recordOutcome?(decisionId: string, outcome: {
    model: NativeModelRef
    role: NativeTaskRole | string
    taskKind: NativeTaskKind
    result: "success" | "failure" | "timeout" | "unknown"
    provenance: "runtime"
    durationMs?: number
    inputTokens?: number
    outputTokens?: number
    taskId?: string
    sessionId?: string
    verification?: "unknown" | "tests" | "artifact"
  }, callerSessionID: string): Promise<void>
}

export type NativeTaskQuestion = {
  id: string
  prompt: string
  options?: string[]
  form?: Record<string, unknown>
}

export type NativeTaskToolActivity = { id: string; name: string; startedAt: number }
export type NativeTaskUsage = { inputTokens: number; outputTokens: number; scope: "session_cumulative" }
export type NativeTaskDelivery = { status: "pending" | "delivered"; messageID?: string; attemptedAt?: number; deliveredAt?: number; attempts: number; lastError?: string }

export type NativeTask = {
  id: string
  rootTaskID: string
  parentTaskID?: string
  rootSessionID: string
  parentSessionID: string
  sessionID?: string
  kind: NativeTaskKind
  parentRole: NativeTaskRole
  role?: NativeTaskRole
  requiredRole?: NativeTaskRole
  sourceDecisionID?: string
  maintenance?: true
  model?: NativeModelRef
  dispatchStatus?: "pending" | "recorded"
  outcomeStatus?: "pending" | "recorded"
  routeStatus?: "pending" | "routed"
  startedAt?: number
  dispatchError?: string
  outcomeError?: string
  failureObservationError?: string
  usage?: NativeTaskUsage
  usageError?: string
  decisionId?: string
  candidates?: readonly NativeCandidate[]
  state: NativeTaskState
  prompt: string
  scope?: string
  acceptance?: string
  createdAt: number
  updatedAt: number
  attempts: number
  progress?: string
  activeTools: NativeTaskToolActivity[]
  question?: NativeTaskQuestion
  questionDelivery?: "pending" | "sent"
  questionDeadlineAt?: number
  questionEscalated?: boolean
  questionEscalationStatus?: "pending" | "sent"
  answer?: unknown
  answerStatus?: "pending" | "sent"
  childrenWakePending?: boolean
  parentWakeMessage?: string
  parentWakeID?: string
  waitForTaskID?: string
  resumeInPlace?: boolean
  executionOutcome?: { state: "succeeded" | "failed"; result?: string; error?: string }
  childTaskIDs: string[]
  result?: string
  error?: string
  delivery?: NativeTaskDelivery
  lastExecutionSequence?: number
  processedEventIDs: string[]
  lastActivityAt: number
}

export type NativeTaskEvent =
  | { id: string; type: "execution.started"; sessionID: string; sequence?: number }
  | { id: string; type: "execution.succeeded"; sessionID: string; sequence?: number; result?: string }
  | { id: string; type: "execution.failed"; sessionID: string; sequence?: number; error: string }
  | { id: string; type: "execution.interrupted"; sessionID: string; sequence?: number }
  | { id: string; type: "tool.started"; sessionID: string; toolID: string; toolName: string }
  | { id: string; type: "tool.finished"; sessionID: string; toolID: string }
  | { id: string; type: "progress"; sessionID: string; message: string }
  | { id: string; type: "question.asked"; sessionID: string; question: NativeTaskQuestion }
  | { id: string; type: "question.answered"; sessionID: string; questionID: string; answer: unknown }
  | { id: string; type: "children.waiting"; sessionID: string }

export type NativeTaskRepository = {
  get(taskID: string): Promise<NativeTask | undefined>
  list(): Promise<NativeTask[]>
  save(task: NativeTask): Promise<void>
}

/** Operations implemented directly with OpenCode V2 session and event APIs. */
export type NativeTaskRuntime = {
  resolveCaller(sessionID: string): Promise<{ role: NativeTaskRole; rootSessionID: string }>
  createSession(input: { taskID: string; rootSessionID: string; parentSessionID: string; role: NativeTaskRole; model: NativeModelRef }): Promise<{ sessionID: string }>
  start(input: { sessionID: string; prompt: string }): Promise<void>
  inspect(sessionID: string): Promise<{ state: "running" | "idle" | "interrupted" | "succeeded" | "failed" | "missing"; result?: string; error?: string; failureID?: string; failureModel?: NativeModelRef; failureAt?: number; usage?: NativeTaskUsage }>
  resume(input: { taskID: string; sessionID: string }): Promise<void>
  interrupt(input: { sessionID: string }): Promise<void>
  deliver(input: { parentSessionID: string; taskID: string; result: string }): Promise<void>
  deliveryMessageID?(taskID: string): string
  ask(input: { parentSessionID: string; taskID: string; question: NativeTaskQuestion }): Promise<void>
  escalateQuestion(input: { rootSessionID: string; taskID: string; question: NativeTaskQuestion }): Promise<void>
  answer(input: { sessionID: string; questionID: string; answer: unknown }): Promise<void>
  continueParent(input: { sessionID: string; taskID: string; message: string; wakeID?: string }): Promise<void>
}

export type NativeTaskEngineOptions = {
  canRunMaintenance?: (task: NativeTask) => Promise<boolean>
  onExecutionFailure?: (task: NativeTask, error: string) => Promise<void>
  repository: NativeTaskRepository
  router: NativeTaskRouter
  runtime: NativeTaskRuntime
  maxConcurrent?: number
  defaultConcurrency?: number
  providerConcurrency?: number | Readonly<Record<string, number>>
  modelConcurrency?: number | Readonly<Record<string, number>>
  silenceTimeoutMs?: number
  activeToolTimeoutMs?: number
  questionTimeoutMs?: number
  now?: () => number
}
