/**
 * packages/model-core/src/model-capabilities/model-knowledge-base.ts
 *
 * Comprehensive model profile knowledge base for momo (My Oh My Openagent).
 * Contains empirical benchmark profiles, context/output token limits, strengths,
 * weaknesses, anti-patterns, and recommended momo agent roles across:
 * 1. OpenCode Zen (`opencode/` provider)
 * 2. OpenCode Go (`opencode-go/` or `go-b/` provider)
 * 3. NeuralWatt (`neuralwatt/` provider)
 */

export type MomoAgentRole =
  | "orchestrator"      // Sisyphus: Top-level plan + delegate, conversational flow
  | "lead_planner"     // Planner / Prometheus: Strategic task decomposition & dependency waves
  | "lead_executor"    // Executor / Hephaestus: Atomic sub-task manager & test verifier
  | "lead_reviewer"    // Reviewer / Momus / Metis: Gap analysis & high-accuracy verification
  | "worker_quick"     // Quick coding worker: High-throughput diffs, routine patches
  | "worker_explore"   // Explore: Codebase grep, symbol search, file pattern finding
  | "worker_research"  // Librarian / Research: Deep external docs, OSS research, large transcript digestion
  | "worker_visual"    // Multimodal Looker / Visual Engineering: UI/UX, CSS, layout audit
  | "advisor"          // Advisor / Oracle: Bound on-demand deep reasoning consultation

export type MomoProviderID =
  | "opencode"
  | "opencode-go"
  | "go-b"
  | "neuralwatt"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "alibaba"
  | "moonshotai"
  | "minimax"
  | "xiaomi"
  | "zai"

export type ModelCostTier = "free" | "budget" | "balanced" | "premium"
export type LatencyTier = "ultra_fast" | "fast" | "moderate" | "slow"
export type SweBenchRankTier = "tier_1_flagship" | "tier_2_high_competence" | "tier_3_utility" | "tier_4_fallback"

export interface CodingBenchmarkProfile {
  readonly sweBenchRankTier: SweBenchRankTier
  readonly sweBenchScorePercentEst: number
  readonly contextWindowTokens: number
  readonly maxOutputTokens: number
  readonly reasoningSupported: boolean
  readonly thinkingType: "adaptive" | "budget" | "implicit" | "none"
  readonly modalities: {
    readonly input: readonly string[]
    readonly output: readonly string[]
  }
}

export interface ModelProfileEntry {
  readonly canonicalId: string
  readonly displayName: string
  readonly family: string
  readonly availableProviders: readonly MomoProviderID[]
  readonly costTier: ModelCostTier
  readonly latencyTier: LatencyTier
  readonly benchmarks: CodingBenchmarkProfile
  readonly description: string
  readonly strengths: readonly string[]
  readonly bestUseCases: readonly string[]
  readonly weaknesses: readonly string[]
  readonly antiPatterns: readonly string[]
  readonly primaryRole: MomoAgentRole
  readonly secondaryRoles: readonly MomoAgentRole[]
  readonly providerNotes?: Partial<Record<MomoProviderID, string>>
}

export const MODEL_KNOWLEDGE_BASE: Record<string, ModelProfileEntry> = {
  // =========================================================================
  // CLAUDE FAMILY (Anthropic)
  // =========================================================================

  "claude-opus-5": {
    canonicalId: "claude-opus-5",
    displayName: "Claude Opus 5",
    family: "claude-opus",
    availableProviders: ["neuralwatt", "opencode", "anthropic"],
    costTier: "premium",
    latencyTier: "moderate",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 81.5,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    description: "Flagship intelligence model. Top-level instruction following across huge prompts, pristine architectural vision.",
    strengths: [
      "Flawless multi-step instruction following across 1,100+ line orchestration prompts",
      "Pristine architectural judgment with zero deviation from structured templates",
      "Superior visual design token analysis and layout-critical debugging",
      "Maintains context stability and coherent tool loops over 100+ turns",
    ],
    bestUseCases: [
      "Top-level orchestrator for mission-critical sessions",
      "Deep architecture consultation via /advisor bind",
      "High-stakes visual and UI engineering verification",
      "Multi-agent team orchestration and conflict resolution",
    ],
    weaknesses: [
      "Expensive blended token pricing; massive cost waste for routine grep/search",
      "Higher TTFT than flash models for simple one-line diffs",
    ],
    antiPatterns: [
      "Never delegate codebase exploration or librarian queries to Opus 5",
      "Avoid using for bulk unit-test generation or repetitive file patching",
    ],
    primaryRole: "orchestrator",
    secondaryRoles: ["advisor", "lead_reviewer", "worker_visual"],
    providerNotes: {
      neuralwatt: "Benefit from NeuralWatt prompt caching to maintain context cheaply across long sessions",
      opencode: "Accessible via OpenCode Zen subscription with full 1M context GA support",
    },
  },

  "claude-sonnet-5": {
    canonicalId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    family: "claude-sonnet",
    availableProviders: ["neuralwatt", "opencode", "anthropic"],
    costTier: "balanced",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 77.2,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 64_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    description: "High-capability coding and execution model balancing deep intelligence with fast response times.",
    strengths: [
      "Optimal balance of high-intelligence execution and fast TTFT",
      "Strong adherence to tool contracts and rigorous verification loops",
      "Cost-efficient alternative to Opus for full file implementations",
    ],
    bestUseCases: [
      "Executor department lead managing multi-wave worker delegations",
      "Complex feature implementation requiring multi-file edits",
      "Balanced plan decomposition when Opus quota is scarce",
    ],
    weaknesses: [
      "Lower max output ceiling (64k) compared to Opus (128k)",
      "Can occasionally gloss over deeply buried edge cases in massive monolithic files",
    ],
    antiPatterns: [
      "Do not burn on trivial 1-line syntax fixes where HY3 or Flash suffices",
    ],
    primaryRole: "lead_executor",
    secondaryRoles: ["lead_planner", "orchestrator", "worker_visual"],
  },

  "claude-fable-5": {
    canonicalId: "claude-fable-5",
    displayName: "Claude Fable 5",
    family: "claude-fable",
    availableProviders: ["opencode", "anthropic"],
    costTier: "premium",
    latencyTier: "moderate",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 80.0,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "adaptive",
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    description: "Master strategic planning model. Produces decision-complete plans leaving zero ambiguity.",
    strengths: [
      "Supreme strategic planning: produces decision-complete plans leaving zero ambiguity",
      "Adaptive thinking depth calibrated dynamically to architectural complexity",
      "Exceptional creative system modeling, dependency graphing, and domain artistry",
    ],
    bestUseCases: [
      "Prometheus strategic planner (ulw-plan backed)",
      "High-accuracy architectural audit and technical debt decomposition",
      "Pre-release release-gate synthesis",
    ],
    weaknesses: [
      "Rejects explicit thinking budgets with 400 (requires adaptive thinking only)",
      "Not designed for continuous iterative execution or repetitive tool loops",
    ],
    antiPatterns: [
      "Never assign to routine coding tasks or repetitive tool calls",
      "Do not pass explicit thinking.type='enabled' budgets to Fable 5",
    ],
    primaryRole: "lead_planner",
    secondaryRoles: ["advisor", "lead_reviewer"],
  },

  // =========================================================================
  // KIMI FAMILY (Moonshot AI)
  // =========================================================================

  "kimi-k3": {
    canonicalId: "kimi-k3",
    displayName: "Kimi K3",
    family: "kimi",
    availableProviders: ["neuralwatt", "opencode-go", "opencode", "moonshotai"],
    costTier: "balanced",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 75.8,
      contextWindowTokens: 1_040_384,
      maxOutputTokens: 131_072,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    description: "Top-tier Claude-like alternative with deep thinking, 1M context, and excellent prompt caching on NeuralWatt.",
    strengths: [
      "Claude-like instruction compliance with deep chain-of-thought thinking",
      "Spectacular prompt cache hit performance on NeuralWatt for long orchestrator sessions",
      "1M context window with high recall across massive transcripts and video/image inputs",
      "Proven orchestrator fallback when Anthropic is unavailable",
    ],
    bestUseCases: [
      "NeuralWatt orchestrator (Sisyphus): zero token cost inflation over long dialogues",
      "On-demand advisor binding via /advisor bind neuralwatt/kimi-k3",
      "Complex multi-file refactoring and dependency analysis",
    ],
    weaknesses: [
      "Can overthink and burn thinking tokens on simple atomic questions if not bounded",
      "Rare MAX_TOKENS exhaustion during intensive thinking (handled by momo retry logic)",
    ],
    antiPatterns: [
      "Avoid unprompted open-ended thinking without clear termination conditions",
    ],
    primaryRole: "orchestrator",
    secondaryRoles: ["advisor", "lead_planner", "worker_visual"],
    providerNotes: {
      neuralwatt: "Preferred orchestrator platform due to high prompt caching benefits",
      "opencode-go": "Available as a high-capacity creative/orchestration option",
    },
  },

  "kimi-k2.7": {
    canonicalId: "kimi-k2.7",
    displayName: "Kimi K2.7 Code",
    family: "kimi-k2",
    availableProviders: ["opencode-go", "moonshotai"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 71.4,
      contextWindowTokens: 262_144,
      maxOutputTokens: 262_144,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    description: "Restrained, outcome-first code generator with 262k token output limit and fast response times.",
    strengths: [
      "Restrained, outcome-first code generation: zero unnecessary filler prose",
      "Massive 262k output limit allows complete module rewrites without chunking",
      "Fast response speed with tight syntax discipline",
    ],
    bestUseCases: [
      "Quick multi-file patching and routine feature development",
      "API client integration and structured TypeScript types generation",
      "Worker execution under Executor lead",
    ],
    weaknesses: [
      "Smaller context window (262k) than 1M flagship models",
      "Less calibrated for top-level multi-agent meta-orchestration",
    ],
    antiPatterns: [
      "Do not use as primary Sisyphus orchestrator when K3 or Claude is available",
    ],
    primaryRole: "worker_quick",
    secondaryRoles: ["lead_executor", "worker_research"],
  },

  // =========================================================================
  // GLM FAMILY (Zhipu AI / Z.ai)
  // =========================================================================

  "glm-5.3-flash": {
    canonicalId: "glm-5.3-flash",
    displayName: "GLM 5.3 Flash",
    family: "glm",
    availableProviders: ["opencode-go", "go-b", "zai"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 72.8,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 131_072,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text", "image", "video", "pdf"], output: ["text"] },
    },
    description: "Modern ultra-cheap flash model with 1M context, native reasoning, and strong tool-calling reliability.",
    strengths: [
      "Exceptional cost-to-performance ratio under OpenCode Go 6x campaign",
      "Full 1M context with native multimodal input (text, image, video, PDF)",
      "Strong analytical reasoning for task decomposition and test verification",
      "Low TTFT and reliable structured JSON output",
    ],
    bestUseCases: [
      "Budget Department Lead (Planner & Executor) in Go-first setups",
      "Algorithmic worker for bug debugging and unit-test execution",
      "Deep codebase exploration and grep analysis across large codebases",
    ],
    weaknesses: [
      "Slightly looser instruction following on workflows exceeding 15+ tool calls",
      "Not maintainer-validated as a replacement for top-level Sisyphus orchestrator",
    ],
    antiPatterns: [
      "Never place as top-level orchestrator in place of Opus or K3",
    ],
    primaryRole: "lead_planner",
    secondaryRoles: ["lead_executor", "worker_quick", "worker_explore"],
    providerNotes: {
      "opencode-go": "Core workhorse under Go 6x campaign; maximum throughput per dollar",
    },
  },

  "glm-5.2": {
    canonicalId: "glm-5.2",
    displayName: "GLM 5.2",
    family: "glm",
    availableProviders: ["neuralwatt", "opencode", "opencode-go"],
    costTier: "budget",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 70.2,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text"], output: ["text"] },
    },
    description: "Affordable GLM generation with calibrated prompt support, useful for budget NeuralWatt advisor binding.",
    strengths: [
      "Claude-like structural response behavior with dedicated GLM prompt tuning",
      "Readily available in NeuralWatt for low-cost advisor consultation",
      "Stable fallback rung across various execution categories",
    ],
    bestUseCases: [
      "Affordable NeuralWatt advisor binding (/advisor bind neuralwatt/glm-5.2)",
      "Secondary execution fallback for mid-level tasks",
    ],
    weaknesses: [
      "Superseded in cost-efficiency and throughput by glm-5.3-flash",
      "Higher latency than the 5.3 flash generation",
    ],
    antiPatterns: [
      "Prefer glm-5.3-flash over 5.2 on OpenCode Go",
    ],
    primaryRole: "advisor",
    secondaryRoles: ["lead_executor", "worker_quick"],
  },

  "big-pickle": {
    canonicalId: "big-pickle",
    displayName: "Big Pickle (GLM 4.6)",
    family: "glm",
    availableProviders: ["opencode"],
    costTier: "free",
    latencyTier: "moderate",
    benchmarks: {
      sweBenchRankTier: "tier_4_fallback",
      sweBenchScorePercentEst: 58.0,
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      reasoningSupported: false,
      thinkingType: "none",
      modalities: { input: ["text"], output: ["text"] },
    },
    description: "Zero-cost safety net on OpenCode Zen, prevents deadlocks when paid quotas exhaust.",
    strengths: [
      "Zero dollar cost on OpenCode Zen; permanently free safety net",
      "Prevents deadlocks or session aborts when all paid API quotas exhaust",
      "Acceptable for simple single-file typo fixes and format cleanups",
    ],
    bestUseCases: [
      "Ultimate terminal fallback across all agent chains",
      "Emergency basic patching during quota reset windows",
    ],
    weaknesses: [
      "Limited context (128k) and small output limit (8k)",
      "Lacks deep multi-file architectural reasoning; easily drifts on nested tasks",
    ],
    antiPatterns: [
      "Never choose intentionally when paid/campaign models are active",
      "Do not delegate multi-file refactors or complex debugging to Big Pickle",
    ],
    primaryRole: "worker_quick",
    secondaryRoles: [],
  },

  // =========================================================================
  // GPT FAMILY (OpenAI)
  // =========================================================================

  "gpt-5.6-sol": {
    canonicalId: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    family: "gpt",
    availableProviders: ["opencode", "openai"],
    costTier: "premium",
    latencyTier: "moderate",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 83.2,
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    description: "Autonomous deep coding flagship. Exceptional at finding race conditions, multi-file invariants, and obscure bugs.",
    strengths: [
      "Supreme autonomous deep debugging: excels at solving obscure race conditions and invariants",
      "Principle-driven problem solver that needs no hand-holding",
      "State-of-the-art SWE-bench ranking; unmatched multi-file logic reconciliation",
    ],
    bestUseCases: [
      "Hephaestus autonomous deep worker (sole automatic model)",
      "Oracle high-IQ architecture and debugging consultation",
      "Advisor consultation for insoluble test failures",
      "Ultralarge complex system invariants verification",
    ],
    weaknesses: [
      "Very high token cost; dangerous to run indiscriminately",
      "Prone to over-orchestration and excess steps on simple, bounded work",
      "Requires concise, principle-driven prompts; degrades under 1,000+ line procedural checklists",
    ],
    antiPatterns: [
      "NEVER use for routine codebase grep/search (use Luna Fast or DeepSeek Flash)",
      "Do not default Sisyphus to Sol unless Claude/Kimi are unavailable",
    ],
    primaryRole: "advisor",
    secondaryRoles: ["lead_executor", "lead_reviewer", "orchestrator"],
    providerNotes: {
      opencode: "Accessible via OpenCode Zen provider key; requires careful gating",
    },
  },

  "gpt-5.6-terra": {
    canonicalId: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    family: "gpt-mini",
    availableProviders: ["opencode", "openai"],
    costTier: "balanced",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 76.5,
      contextWindowTokens: 1_050_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    description: "High-precision critical analysis model with low false-positive rate, built for PR review and verification.",
    strengths: [
      "High-precision critical analysis with a low false-positive rate",
      "Sharp bug detection and boundary condition analysis during PR review",
      "Balanced cost profile for verification passes",
    ],
    bestUseCases: [
      "Momus / Reviewer default high-accuracy code and plan reviewer",
      "Secondary verification pass on critical pull requests",
    ],
    weaknesses: [
      "Less autonomous on open-ended greenfield design compared to Sol",
    ],
    antiPatterns: [
      "Do not use for fast line-level utility edits (overkill compared to Go models)",
    ],
    primaryRole: "lead_reviewer",
    secondaryRoles: ["lead_planner"],
  },

  "gpt-5.6-luna-fast": {
    canonicalId: "gpt-5.6-luna-fast",
    displayName: "GPT-5.6 Luna Fast",
    family: "gpt-nano",
    availableProviders: ["opencode", "openai"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 70.1,
      contextWindowTokens: 400_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    description: "Ultra-fast lightweight model with sharp syntactic reasoning for rapid code search and documentation lookup.",
    strengths: [
      "Ultra-fast TTFT with sharp syntactic reasoning",
      "High precision on targeted file searches and regex-driven code exploration",
      "Default utility leader for Explorer and Librarian in OpenCode Zen",
    ],
    bestUseCases: [
      "Fast codebase grep and symbol referencing (Explore agent)",
      "Documentation lookup and OSS pattern matching (Librarian agent)",
      "Rapid sanity checking of syntax errors",
    ],
    weaknesses: [
      "400k context window is smaller than 1M+ flagship models",
      "Can truncate context aggressively if given monolithic tasks",
    ],
    antiPatterns: [
      "Do not assign multi-step planning or end-to-end feature implementations",
    ],
    primaryRole: "worker_explore",
    secondaryRoles: ["worker_research", "worker_quick"],
  },

  // =========================================================================
  // DEEPSEEK FAMILY
  // =========================================================================

  "deepseek-v4-flash": {
    canonicalId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    family: "deepseek",
    availableProviders: ["opencode-go", "go-b", "deepseek"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 71.8,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 32_768,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text"], output: ["text"] },
    },
    description: "Blazing fast generation speed with rock-bottom cost; ideal for codebase grep, file discovery, and fast diffs.",
    strengths: [
      "Blazing fast generation speed with rock-bottom token cost",
      "Superb codebase exploration, file grepping, and pattern identification",
      "Clean atomic code diff generation without conversational bloat",
    ],
    bestUseCases: [
      "Explore agent: Top recommendation for codebase grep and discovery",
      "Routine single-file bug fix patches dispatched by Executor",
      "High-speed fallback dispatcher in manager layer",
    ],
    weaknesses: [
      "32k token output limit prevents generating huge monolithic files in one turn",
      "Lacks patience for recursive multi-turn meta-orchestration",
    ],
    antiPatterns: [
      "NEVER use as Sisyphus orchestrator (collapses under nested prompts)",
      "Do not expect monolithic 1,000+ line single-turn code generation",
    ],
    primaryRole: "worker_explore",
    secondaryRoles: ["worker_quick"],
    providerNotes: {
      "opencode-go": "Ultra-cheap worker lane under Go; zero latency overhead",
    },
  },

  "deepseek-v4-pro": {
    canonicalId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    family: "deepseek",
    availableProviders: ["neuralwatt", "opencode-go", "deepseek"],
    costTier: "balanced",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 77.0,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 32_768,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text"], output: ["text"] },
    },
    description: "Deep mathematical and algorithmic programming specialist; rivals GPT-5.6 Sol at a fraction of the cost.",
    strengths: [
      "Exceptional algorithmic, mathematical, and low-level systems programming IQ",
      "Autonomous deep problem solving that closely rivals GPT-5.6 Sol at 5x lower cost",
      "Available on NeuralWatt for budget-friendly deep reasoning consultation",
    ],
    bestUseCases: [
      "Deep algorithmic implementation (compilers, parsing, concurrency, cryptography)",
      "Low-cost technical advisor consultation via NeuralWatt",
      "Execution worker for mathematically dense components",
    ],
    weaknesses: [
      "32k output ceiling requires chunked file generation",
      "Less suited for sociable conversational orchestration",
    ],
    antiPatterns: [
      "Do not use for high-level Sisyphus delegation loops",
    ],
    primaryRole: "lead_executor",
    secondaryRoles: ["advisor", "worker_quick"],
    providerNotes: {
      neuralwatt: "Excellent cost-efficient alternative to Sol for deep algorithmic advisory",
    },
  },

  // =========================================================================
  // QWEN FAMILY (Alibaba)
  // =========================================================================

  "qwen3.8-flash": {
    canonicalId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    family: "qwen",
    availableProviders: ["opencode-go", "go-b", "alibaba"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 71.0,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 131_072,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    description: "Instantaneous TTFT and lowest token cost; the optimal manager dispatcher and quick-fix worker.",
    strengths: [
      "Industry-leading ultra-low TTFT: instantaneous dispatch decisions",
      "Highly cost-effective under OpenCode Go 6x promotional campaign",
      "Sharp classification and categorization of incoming user requests",
      "Huge 1M context with 131k output limit and vision/video capabilities",
    ],
    bestUseCases: [
      "Tier-2 Manager (Dispatcher): Evaluates tasks and routes to Planner/Executor/Reviewer",
      "Quick patching and small routine script generation",
      "High-throughput utility routing",
    ],
    weaknesses: [
      "Fails when asked to manage deep multi-agent coordination loops",
      "Maintains maintainer warning: strongly discouraged as Sisyphus orchestrator",
    ],
    antiPatterns: [
      "NEVER use as Sisyphus orchestrator (lacks stamina for nested delegation)",
    ],
    primaryRole: "worker_quick",
    secondaryRoles: ["worker_explore"],
    providerNotes: {
      "opencode-go": "Official recommended manager dispatcher model in momo deployment profile",
    },
  },

  "qwen3.7-plus": {
    canonicalId: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    family: "qwen",
    availableProviders: ["opencode-go", "go-b", "alibaba"],
    costTier: "budget",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 73.5,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 64_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    description: "High needle-in-haystack recall across 1M context; excels at deep documentation and research digestion.",
    strengths: [
      "Superb needle-in-a-haystack retrieval across 1,000,000 token contexts",
      "High-speed reasoning with strong code comprehension",
      "Excellent documentation digest and test suite analysis capabilities",
    ],
    bestUseCases: [
      "Research & Librarian agent: Deep research across external docs, changelogs, and APIs",
      "Planner lead: Detailed requirement analysis from massive legacy codebases",
      "Codebase exploration when search terms are ambiguous",
    ],
    weaknesses: [
      "Can produce verbose responses if not prompt-bounded",
      "Not verified for primary Sisyphus orchestration",
    ],
    antiPatterns: [
      "Do not use as top-level orchestrator",
    ],
    primaryRole: "worker_research",
    secondaryRoles: ["lead_planner", "worker_explore"],
  },

  // =========================================================================
  // HUNYUAN FAMILY (Tencent)
  // =========================================================================

  "hy3": {
    canonicalId: "hy3",
    displayName: "Hunyuan 3 (HY3)",
    family: "Hy",
    availableProviders: ["opencode-go", "go-b"],
    costTier: "budget",
    latencyTier: "ultra_fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 72.4,
      contextWindowTokens: 256_000,
      maxOutputTokens: 128_000,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text"], output: ["text"] },
    },
    description: "Fastest token throughput in OpenCode Go; pristine code patching, unified diffs, and test generation.",
    strengths: [
      "Unrivaled token throughput: fastest code generation rate in OpenCode Go",
      "Exceptionally clean syntax on unified diffs and file edits",
      "Follows precise line-replacement instructions with zero hallucinations",
    ],
    bestUseCases: [
      "Primary code implementation worker dispatched by Executor (catalog_pick(need='cheap'))",
      "Refactoring repetitive patterns across multiple localized files",
      "Automated unit test writing and benchmark script generation",
    ],
    weaknesses: [
      "256k context window is smaller than 1M models (requires scoped inputs)",
      "Lacks high-level architectural foresight; purely an execution engine",
    ],
    antiPatterns: [
      "Do not ask HY3 to architect entire systems or resolve vague user requirements",
    ],
    primaryRole: "worker_quick",
    secondaryRoles: ["lead_executor"],
    providerNotes: {
      "opencode-go": "Flagship high-throughput coding worker under Go campaign",
    },
  },

  // =========================================================================
  // MINIMAX FAMILY
  // =========================================================================

  "minimax-m3": {
    canonicalId: "minimax-m3",
    displayName: "MiniMax M3",
    family: "minimax",
    availableProviders: ["opencode-go", "opencode", "minimax"],
    costTier: "budget",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_2_high_competence",
      sweBenchScorePercentEst: 70.0,
      contextWindowTokens: 1_048_576,
      maxOutputTokens: 512_000,
      reasoningSupported: true,
      thinkingType: "implicit",
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    },
    description: "Massive 512k token output limit and 1M context; excels at dumping large documentation sets and schema files.",
    strengths: [
      "Staggering 512,000 token output limit: can dump entire files/logs without truncation",
      "1M context window with multimodal input capability",
      "Excellent utility worker for large volume documentation parsing",
    ],
    bestUseCases: [
      "Librarian/Research agent: Digesting massive documentation sets",
      "Generating large-scale documentation, schemas, or bulk boilerplate",
      "Utility fallback across Explore and Librarian chains",
    ],
    weaknesses: [
      "Loses conversational coherence and discipline across multi-step tool loops",
      "Strict maintainer directive: STRONGLY DISCOURAGED as Sisyphus orchestrator",
    ],
    antiPatterns: [
      "NEVER set as Sisyphus orchestrator",
      "Avoid using as Hephaestus or Oracle deep specialist",
    ],
    primaryRole: "worker_research",
    secondaryRoles: ["worker_explore", "worker_quick"],
  },

  // =========================================================================
  // GEMINI FAMILY (Google)
  // =========================================================================

  "gemini-3.1-pro": {
    canonicalId: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    family: "gemini",
    availableProviders: ["opencode", "google"],
    costTier: "balanced",
    latencyTier: "fast",
    benchmarks: {
      sweBenchRankTier: "tier_1_flagship",
      sweBenchScorePercentEst: 77.5,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 65_000,
      reasoningSupported: true,
      thinkingType: "budget",
      modalities: { input: ["text", "image", "video", "audio", "pdf"], output: ["text"] },
    },
    description: "Multimodal leader for UI/UX visual regression, design-token layout auditing, and architectural review.",
    strengths: [
      "Industry-leading multimodal analysis: screenshot inspection and UI/UX layout auditing",
      "Massive 1M+ context window with rapid ingestion of full design specs and video recordings",
      "Different reasoning style from Claude/GPT; excellent alternative perspective in reviews",
    ],
    bestUseCases: [
      "Multimodal Looker / Visual Engineering: UI layout and visual regression auditing",
      "Momus reviewer fallback for frontend and web applications",
      "Oracle secondary advisory perspective",
    ],
    weaknesses: [
      "Tool-call sequencing differs subtly from OpenAI/Anthropic norms",
      "Less calibrated for 1,100-line Sisyphus procedural prompt mechanics",
    ],
    antiPatterns: [
      "Do not use as Sisyphus orchestrator lead",
    ],
    primaryRole: "worker_visual",
    secondaryRoles: ["lead_reviewer", "advisor"],
  },
}

// ===========================================================================
// HELPER QUERY FUNCTIONS
// ===========================================================================

/**
 * Normalizes any model ID string (with or without provider prefixes) to match knowledge base keys.
 */
export function normalizeKnowledgeBaseKey(modelId: string): string {
  const lower = modelId.trim().toLowerCase()
  const base = lower.includes("/") ? lower.split("/").pop()! : lower
  const stripped = base.split(":")[0]!.trim()
  return stripped
}

/**
 * Retrieve model profile by canonical ID or raw provider model ID string.
 */
export function getModelProfile(modelId: string): ModelProfileEntry | undefined {
  const key = normalizeKnowledgeBaseKey(modelId)
  if (MODEL_KNOWLEDGE_BASE[key]) {
    return MODEL_KNOWLEDGE_BASE[key]
  }
  for (const [canonicalKey, entry] of Object.entries(MODEL_KNOWLEDGE_BASE)) {
    if (key.startsWith(canonicalKey) || canonicalKey.startsWith(key)) {
      return entry
    }
  }
  return undefined
}

/**
 * Find all models recommended for a specific momo agent role, optionally filtered by provider.
 */
export function getModelsByRole(
  role: MomoAgentRole,
  providerFilter?: MomoProviderID,
): ModelProfileEntry[] {
  return Object.values(MODEL_KNOWLEDGE_BASE).filter((entry) => {
    const roleMatches = entry.primaryRole === role || entry.secondaryRoles.includes(role)
    if (!roleMatches) return false
    if (!providerFilter) return true
    return entry.availableProviders.includes(providerFilter)
  })
}

/**
 * Find all models available under a specific provider (e.g. "opencode-go", "neuralwatt", "opencode").
 */
export function getModelsByProvider(provider: MomoProviderID): ModelProfileEntry[] {
  return Object.values(MODEL_KNOWLEDGE_BASE).filter((entry) =>
    entry.availableProviders.includes(provider),
  )
}
