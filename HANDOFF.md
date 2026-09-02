# HANDOFF — momo session (2026-09-02): delegation repair + waves + W7 QA in flight

Handoff context for continuing in a fresh session. Prior session's QA reference
(2026-09-01) is condensed at the bottom — its lessons (OPENCODE_PURE, dist
externals, QA config path) remain operational.

## USER REQUESTS (AS-IS)

- "projeyi analiz et @AGENTS.md , @plan.md gibi dosyarı oku kaldığımız noktayı anla ve geliştirme önerilerinde bulun. @README.md de şuan iyi durumda olmalı özet olarak. amacımız token efficent bir sistem oluşturmak token başına maksimum performansı istiyorum kendi kullanım senaryom için. fakat önemli bir mesele var, bu araç tamamen benim kullanımım için optimize edildi yinede opensource olarak paylaşıyorum repoyu. araç içinde sağda solda sıkıntı olacak bilgiler bırakamayız. sen şimdi repo ya bak daha optimize olmak için neler yapabiliriz adaptif promt lu ajanlar falan düşünmüştüm o gibi seyleri falan değerlendir."
- "planı hazırla alt ajanlarla uygulamaya başla ayrıca mevcut projemiz olan momo yu nasıl daha sade ve kullanışlı hale getirebiliriz bununla ilgili bir düşün. komutları sadeleştirebiliriz, tool call kısmını daha optimize yapabiliriz claude code da bunun için paylaşılan eklentiler vardı. büyük modeli nasıl en verimli kullanırız. bunları bir düşün bu sistem benim iş akışıma uygun olmalı ben iki opencode go paketi birde neuralwatt aboneliği kullanıyorum bunların kendine özel durumlarını göz önünde bulundurup ona gö¶e alt ajan çağırma işini yapabiliriz mesela. ufak ajanlar araştırma yaparak çok güzel sonuçlar elde edebiliyor bazen ama her zaman değil, bu optimizasyonları bir değerlendirebiliriz. eldeki mcp leri nasıl daha iyi ve optimize yapabiliriz onu bir düşün."
- "glm 5.2 hangisninde çalışıyorsa durdur şunu hayvan gibi token yakıyor."
- "glm 5.2 kullanan ajan hangisi bilmiyorum fakat o go paketinin günlük kullanım dolmuş kontrol etsene go paketinin limit dolunca bir sonraki güne kadar bekleme yapabiliyor."
- "bir şeyi yanlış mı anladın bana mı öyle geliyor. ben liste olmasını istemedim ajan listesi düzenle falan da demedim. tamamen orkestratör tarafından kararlaştırılsın dedim. ben bir orkestratör yazarım hangi ajan hangi modele sahip olacak o seçer. nuralwat first falan bir durum yok ortada."
- "eski haline getirmen gibi bir talebim yok zaten böyle bir listeye esasen ihtiyacımız yok. direk silebiliriz gereksiz yerleri tutmaya gerek yok."
- "opencode u tekrar başlattım. bir kaç hatamız var anlaşılan bunları tespit etmeni ve düzeltmeni istiyorum. öncellikle translator adımı düzgün çalışmıyor gibi google api düzgün çalışmıyor olabilir yada hata dönüyordur loglara falan bakım anlamaya çalış. sonrasında @plan.md ye ekleme yaptırdım alt ajanlar kendi ajanlarını çağıramıyor tam istediğim gibi değil yapısı. proje özüne uygun çalışmıyor omo ile karışık frankeshtain gibi bir şey oldu. mcp ile ajan seçme işi düzgün değil gibi onu bir gözetle kendin deneyler yürüt ve karar ver. gerekli yerde alt ajanlar çagır kodu yazdır denetimini yap bana sonra haber ver."
- "çalıştırdığın ajanı kontrol etsene 25dk oldu sonuç dönmedi."
- "her ne eksik kaldıysa kendin tamamla plan md yi güncelle hatta paralel çalış fazla uzun bir iş varsa go aboneliklerinden birini kullanarak glm5.3 flash alt ajanı oluştur o yapsın. sen başka iş yap ardından commit push yap toplanmam gerek başka zaman devam edeceğiz."

## GOAL

Collect the in-flight W7 real-harness QA evidence (bg_a82cded1, evidence dir
`.omo/evidence/20260902-wave-qa/`), process PASS/FAIL into frankenstein.md, then
continue the remaining queue (docs polish, optional W6 tool-description trim,
codegraph MCP timeout debug).

## WORK COMPLETED (2026-09-02 session)

- Full analysis: progress vs plan.md, sensitive-info audit, token-efficiency
  audit, adaptive-prompt evaluation → prioritized backlog; then a 6-wave plan
  (plan agent) + CC pattern research saved to `notes/claude-code-patterns.md`.
- Waves executed via background workers + my surgical fixes:
  - W1: remote MCPs (websearch/context7/grep_app) opt-in, telemetry default OFF,
    rulesInjector verbosity gate wired (`token_burn.rules_injector_verbose`).
  - W3: momo-core prompt sections (hard delegation + catalog-first + ponytail
    ladder + minimal output) injected into ALL model-family variants
    (`agents/sisyphus/momo-core-sections.ts` + factory append); orchestrator
    thinking budget 32000→10000 (config `sisyphus_agent.thinking_budget_tokens`);
    invalid example categories fixed (frontend→visual-engineering etc.).
  - W5: explore/librarian prompts cut ~45-55% (output contracts kept verbatim).
  - W2: lean default roster — `V1_DISABLED_COMMANDS_DEFAULT`
    (refactor/hyperplan/remove-ai-slops), skills default-off roster via
    `skills.enable_default_off` (`features/builtin-skills/default-off-skills.ts`
    + chokepoints: command-config-handler, skill-context, available-skills,
    createPluginModule runtime-security selection).
  - Wave 8: planner + executor manager agents (`src/agents/{planner,executor}/`,
    prompts in packages/prompts-core/prompts/{planner,executor}/default.md),
    MANAGER_AGENT_NAMES + canSpawnWorkers (sync-only nesting), preflight loop
    rules, tool restrictions, `delegation.managers` gate default TRUE (user
    override of plan's false), depth guard verified on sync chain.
  - Translator hardening: retry once with doubled maxOutputTokens on
    thinking-model MAX_TOKENS exhaustion + visible retry/failure logging.
- Two systemic delegation bugs fixed by me directly (delegation was broken, so
  it could not be delegated):
  - Sisyphus-Junior registered (removed from `V1_DISABLED_AGENTS_DEFAULT` in
    `config/validate.ts`) — category tasks died at spawn with
    `Agent "Sisyphus-Junior" not found` (6 ms after session creation).
  - Explicit `task(model=...)` honored on named-agent delegations
    (`tools/delegate-task/subagent-resolver.ts` + test) — previously only the
    category path honored it.
- Provider-bias removed per user's architecture ruling ("orchestrator decides"):
  all `agents.*.models`/`categories.*.models` lists deleted from
  `~/.omo/omo.jsonc`; neuralwatt-first chain prepends reverted (6 model-core
  files to HEAD); `catalog.prefer_providers` default `[]` (key stays, opt-in).
- Delegation lanes verified live via DB-checked probes (category + named-agent,
  both resolving neuralwatt with explicit params, 2 messages = completed).
- Diagnosed: opencode-go pack has a 5-HOUR rolling limit (not daily; error text
  verbatim: `5-hour usage limit reached. Resets in 1hr 49min...`);
  runtime_fallback cycles chain rungs correctly on it; stale dist was the root
  of the confusion cascade (plugin loads `dist/index.js`; source fixes are
  inert until `bun run build` + restart).
- Committed and pushed EVERYTHING: `41b3d274f` on `dev` (98 files,
  +12635/−6776) → origin. dist rebuilt (Eyl 2 21:30).
- Created `frankenstein.md` (issue log F1-F10 with statuses/verification;
  single-writer: orchestrator) and updated `plan.md` (Wave 8/9 done, Phase 4B
  implemented, delegation.managers default true note).

## CURRENT STATE

- **W7 QA COMPLETE (2026-09-02 evening): 5/5 PASS** — category e2e (junior spawn
  + model param), named-agent model param, planner/executor registration +
  managers gate (works via the `[opencode]` block — see F11), remote MCP opt-in
  (catalog/codegraph/lsp only), isolation (real DB untouched; +1 delta =
  user's own live session). Evidence: `.omo/evidence/20260902-wave-qa/`.
- **NEW HIGH ISSUE (F11)**: the omo.jsonc layer loader (`.strict()`) silently
  voids the whole file on unknown top-level keys — the real user's
  `~/.omo/omo.jsonc` (top-level `$schema`/`local_translator`/`_migrations`) is
  currently INERT; `[opencode]`-block keys work. Fix queued for next session
  (frankenstein.md F11/F11b-F11d).
- F7 FIXED (2026-09-02 late): `omo doctor` roster check warns when
  `packages/omo-opencode/src` is newer than `dist/index.js`
  (`collectStaleDistIssue`, tested) + the same probe at plugin bootstrap
  (`warnIfStaleDistBundle` in create-plugin-module.ts).
- F12 FIXED (2026-09-02 late): dist node-compat regression — the dist bundled
  the CJS `cross-spawn` dep with bun's `__require = import.meta.require` shim
  (undefined under node); cross-spawn is now a direct dependency (hoisted) and
  `--external cross-spawn` in `script/build.ts` index node (zod precedent).
- Working tree: my work fully committed and pushed to origin/dev. NOTE: a
  concurrent session has uncommitted WIP in the tree (loader.ts F11b
  diagnostics fix, codex-components test updates, frankenstein.md rewrite,
  ROADMAP.md/bun.lock) — leave it alone, it is not mine to commit.
- Tests: full plugin suite 8521 tests, 0 fail in the latest run (the 3
  codex-components environment failures were cleared by the concurrent
  session's test updates); model-core 358/358; typecheck 0 errors.
- `dist/index.js` rebuilt with all fixes + `--external cross-spawn`; restart
  opencode to load it.
- `~/.omo/omo.jsonc`: only behavior settings remain (runtime_fallback,
  background_task, team_mode, experimental + top-level local_translator). NO
  model lists anywhere. NOTE (F11): until F11 is fixed, omo.jsonc top-level
  keys are inert — put overrides inside the `[opencode]` block.

## PENDING TASKS

- FIRST: coordinate with the concurrent session (they have uncommitted WIP:
  loader.ts F11b diagnostics fix, codex-components test updates,
  frankenstein.md rewrite) — then fix F11 proper (omo.jsonc strict-layer
  voiding — frankenstein.md).
- QA verdicts: DONE — recorded in frankenstein.md (F4 live-QA note, F11
  family) and in this file (5/5 PASS).
- Docs: README/HELP updates for landed waves (MCP opt-in, telemetry default,
  skills.enable_default_off, delegation.managers, thinking budget 10000,
  planner/executor); frankenstein.md F8 (plan.md drift) mostly resolved, finish.
- W6 (optional, user never prioritized): CC-style tool description trim
  (≤600 chars + shape test) — follow `notes/claude-code-patterns.md` rules 1-3;
  touch `src/tools/*` descriptions + `mcp/model-catalog-server.ts`
  CATALOG_MCP_TOOLS.
- Known open issues (frankenstein.md): F7 stale-dist warning now FIXED (doctor
  + bootstrap probe); remaining: codegraph MCP runtime timeout (-32001,
  deferred), translator gemma thinkingConfig research (inconclusive; retry
  covers the failure mode), F12 prompt-bloat investigation (concurrent
  session's entry).

## KEY FILES

- `frankenstein.md` — issue log F1-F12 (statuses + verification; single-writer — currently the concurrent session)
- `plan.md` — wave statuses + Phase 4B design (Wave 8 source of truth)
- `packages/omo-opencode/src/tools/delegate-task/subagent-resolver.ts` — explicit model param precedence fix
- `packages/omo-opencode/src/config/validate.ts` — V1_DISABLED_AGENTS_DEFAULT (junior removed) + V1_DISABLED_COMMANDS_DEFAULT
- `packages/omo-opencode/src/agents/sisyphus/momo-core-sections.ts` — shared momo-core prompt block (all variants)
- `packages/omo-opencode/src/agents/{planner,executor}/` — Wave 8 manager agents (+ packages/prompts-core/prompts/{planner,executor}/default.md)
- `packages/omo-opencode/src/features/builtin-skills/default-off-skills.ts` — W2 lean skill roster
- `packages/omo-opencode/src/features/local-translator/translator.ts` — thinking-model retry + logging
- `notes/claude-code-patterns.md` — CC tool/prompt patterns (input for W6)
- `packages/omo-opencode/dist/index.js` — built plugin the user's opencode loads

## IMPORTANT DECISIONS

- "Orchestrator decides models": NO static provider lists in config, NO
  provider-first chains in code. Mechanism: catalog_pick (cost/capability
  neutral) → explicit task(model=...) → honored on both paths. Chains are
  provider-neutral availability fallbacks.
- Disable-by-default, never delete (agents, commands, skills).
- delegation.managers default TRUE (user overrode plan.md's false).
- frankenstein.md single-writer: workers report via task results; the
  orchestrator consolidates.
- Worker lanes: subagent_type=general with explicit model params (neuralwatt:
  glm-5.2 for implementation, kimi-k3-fast/glm-5.2-fast for small tasks); go
  packs NOT used for sub-agents (5-hour rolling limits).
- One comprehensive commit acceptable (precedent dd810b3c8).

## EXPLICIT CONSTRAINTS

- "nuralwat first falan bir durum yok ortada" (no provider-first anything)
- "tamamen orkestratör tarafından kararlaştırılsın" (model selection fully
  orchestrator-decided)
- "direk silebiliriz gereksiz yerleri tutmaya gerek yok" (delete redundant
  config lists)
- "ucuz alt ajanlar kullan" + "spesifik bir iş ve promt ayarla boşa para
  harcama" (cheap sub-agents, precise prompts, no waste)
- Repo conventions (AGENTS.md): no `as any`/`@ts-ignore`; bun:test
  given/when/then; NEVER assert authored prompt wording in tests; ~200 LOC soft
  cap; QA mandate for src/ changes (opencode-qa skill, isolated XDG) before
  commit.

## CONTEXT FOR CONTINUATION

- CRITICAL: plugin runs from `dist/index.js` — source fixes are INERT until
  `bun run build` + opencode restart. Build+restart before live verification of
  any new source change.
- CRITICAL: restarting opencode kills in-flight background tasks (they live in
  the server process). Check evidence dirs before restarting.
- Probing methodology (proven): launch trivial task() with explicit model, then
  `sqlite3 ~/.local/share/opencode/opencode.db "SELECT model, (SELECT count(*)
  FROM message m WHERE m.session_id=session.id) FROM session WHERE id='...'"` —
  model column + message count verifies the lane without burning tokens.
- opencode log: `~/.local/share/opencode/log/opencode.log` (UTC timestamps).
  `prompt_async failed` and `stream error` lines are the diagnostic goldmine.
- The 3 codex-components test failures are pre-existing/environmental (Codex
  binary + sg resolution) — documented, do not chase.
- Codegraph MCP times out at runtime (MCP error -32001) — known, deferred; use
  direct file reads instead.
- gemma-4-31b-it (translator cloud model) is a THINKING model — thought parts
  can exhaust max_output_tokens; retry hardening landed; revisit thinkingConfig
  if Google documents gemma support.

---

# PRIOR QA REFERENCE (2026-09-01 session — condensed, still operational)

## QA recipe (CORRECTED — mind the config path)

```bash
# 1. QA config MUST be at $XDG_CONFIG_HOME/opencode/opencode.jsonc
#    (NOT $XDG_CONFIG_HOME/opencode.json — that path is ignored)
# 2. Unset the nested-session env vars so plugins load.
env -u OPENCODE_PURE -u OPENCODE -u OPENCODE_PID \
  XDG_CONFIG_HOME=/tmp/opencode/qa-sandbox/config \
  XDG_DATA_HOME=/tmp/opencode/qa-sandbox/data \
  XDG_STATE_HOME=/tmp/opencode/qa-sandbox/state \
  XDG_CACHE_HOME=/tmp/opencode/qa-sandbox/cache \
  HOME=/tmp/opencode/qa-home \
  opencode run "..." --format json
```

- Plugin dir for bare copies must ship node_modules (zod, ajv, ajv-formats) or
  the import fails SILENTLY (loader publishes the error before `opencode run`
  subscribes). The repo dist needs nothing (repo node_modules resolve).
- CJS plugins rejected; ESM `export default` works. V1 shape `{ id, server }`
  detected, `server()` invoked.
- opencode ALWAYS walks `$HOME/.opencode/opencode.json` (not XDG-isolated).
- `~/.local/bin/opencode` v1.18.25+; real DB
  `~/.local/share/opencode/opencode.db`; momo log `/tmp/oh-my-opencode.log`
  (shared append-only; 500 ms/50-line buffer can lose very short runs' lines).
- Host quirk: inotify watch-limit warnings (`.git No space left on device`)
  appear but the harness keeps running.
- Old session's open items partially superseded: 402 hardening suggestion
  (add 402 to default retry list / catalog-aware pruning) still open; the
  sisyphus-chain reorder in omo.jsonc was later replaced by the list deletion
  (2026-09-02, see F3 above).
