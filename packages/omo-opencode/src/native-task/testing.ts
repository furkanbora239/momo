import type {
  NativeModelRef,
  NativeRouteInput,
  NativeRouteResult,
  NativeTask,
  NativeTaskRepository,
  NativeTaskRole,
  NativeTaskRouter,
  NativeTaskRuntime,
} from "./types"

export class MemoryNativeTaskRepository implements NativeTaskRepository {
  private readonly records = new Map<string, NativeTask>()
  async get(taskID: string): Promise<NativeTask | undefined> {
    const record = this.records.get(taskID)
    return record === undefined ? undefined : structuredClone(record)
  }
  async list(): Promise<NativeTask[]> { return [...this.records.values()].map((record) => structuredClone(record)) }
  async save(task: NativeTask): Promise<void> { this.records.set(task.id, structuredClone(task)) }
}

export class FakeNativeTaskRouter implements NativeTaskRouter {
  routeResult: (input: NativeRouteInput) => NativeRouteResult | Promise<NativeRouteResult> = () => ({
    kind: "selected",
    decisionId: "decision-1",
    role: "worker",
    model: { providerID: "test", id: "model" },
  })
  selectionResult: (decisionId: string, model: NativeModelRef, role: NativeTaskRole) => NativeRouteResult = (_decisionId, model, role) => ({
    kind: "selected",
    decisionId: "decision-1",
    role,
    model,
  })
  readonly routeInputs: NativeRouteInput[] = []
  bindResearch?: NativeTaskRouter["bindResearch"]
  revalidateSelected?: NativeTaskRouter["revalidateSelected"]
  async route(input: NativeRouteInput): Promise<NativeRouteResult> {
    this.routeInputs.push(input)
    return this.routeResult(input)
  }
  async select(decisionId: string, model: NativeModelRef, role: Parameters<NativeTaskRouter["select"]>[2]): Promise<NativeRouteResult> {
    return this.selectionResult(decisionId, model, role)
  }
}

export class FakeNativeTaskRuntime implements NativeTaskRuntime {
  readonly callers = new Map<string, { role: import("./types").NativeTaskRole; rootSessionID: string }>()
  readonly starts: Array<{ taskID: string; role: string; prompt: string }> = []
  readonly resumes: Array<{ taskID: string; sessionID: string }> = []
  readonly interrupts: string[] = []
  readonly deliveries: Array<{ taskID: string; result: string }> = []
  readonly questions: string[] = []
  readonly questionAttempts: Array<{ taskID: string; questionID: string }> = []
  readonly escalations: string[] = []
  readonly answers: Array<{ questionID: string; answer: unknown }> = []
  readonly parentContinuations: string[] = []
  startError?: Error
  deliverAction?: () => Promise<void>
  answerAction?: () => Promise<void>
  escalationAction?: () => Promise<void>
  askAction?: () => Promise<void>
  async resolveCaller(sessionID: string): Promise<{ role: import("./types").NativeTaskRole; rootSessionID: string }> {
    return this.callers.get(sessionID) ?? { role: "orchestrator", rootSessionID: sessionID }
  }
  async createSession(input: Parameters<NativeTaskRuntime["createSession"]>[0]): Promise<{ sessionID: string }> {
    this.starts.push({ taskID: input.taskID, role: input.role, prompt: "" })
    if (this.startError !== undefined) throw this.startError
    const sessionID = `session-${input.taskID}`
    this.callers.set(sessionID, { role: input.role, rootSessionID: input.rootSessionID })
    return { sessionID }
  }
  async start(input: Parameters<NativeTaskRuntime["start"]>[0]): Promise<void> {
    const taskID = input.sessionID.replace("session-", "")
    const entry = this.starts.find((candidate) => candidate.taskID === taskID)
    if (entry !== undefined) entry.prompt = input.prompt
  }
  async inspect(): Promise<Awaited<ReturnType<NativeTaskRuntime["inspect"]>>> { return { state: "idle" } }
  async resume(input: Parameters<NativeTaskRuntime["resume"]>[0]): Promise<void> { this.resumes.push(input) }
  async interrupt(input: Parameters<NativeTaskRuntime["interrupt"]>[0]): Promise<void> { this.interrupts.push(input.sessionID) }
  async deliver(input: Parameters<NativeTaskRuntime["deliver"]>[0]): Promise<void> {
    this.deliveries.push({ taskID: input.taskID, result: input.result })
    await this.deliverAction?.()
  }
  deliveryMessageID(taskID: string): string { return `native-delivery-${taskID}` }
  async ask(input: Parameters<NativeTaskRuntime["ask"]>[0]): Promise<void> {
    this.questions.push(input.question.id)
    this.questionAttempts.push({ taskID: input.taskID, questionID: input.question.id })
    await this.askAction?.()
  }
  async escalateQuestion(input: Parameters<NativeTaskRuntime["escalateQuestion"]>[0]): Promise<void> {
    this.escalations.push(input.question.id)
    await this.escalationAction?.()
  }
  async answer(input: Parameters<NativeTaskRuntime["answer"]>[0]): Promise<void> {
    this.answers.push({ questionID: input.questionID, answer: input.answer })
    await this.answerAction?.()
  }
  async continueParent(input: Parameters<NativeTaskRuntime["continueParent"]>[0]): Promise<void> { this.parentContinuations.push(input.message) }
}
