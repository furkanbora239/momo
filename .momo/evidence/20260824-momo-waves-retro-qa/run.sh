#!/usr/bin/env bash
# QA driver — isolated XDG harness for momo commit dd810b3c8 + pass-4 wiring fixes.
# Run from the repo root:
#   bash .omo/evidence/20260824-momo-waves-retro-qa/run.sh
set -uo pipefail
EVID="/home/furkanbora/code/ai/omo/.omo/evidence/20260824-momo-waves-retro-qa"
REPO="/home/furkanbora/code/ai/omo"
REAL_DB="$HOME/.local/share/opencode/opencode.db"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { printf '[%s] %s\n' "$(TS)" "$*" | tee -a "$EVID/timeline.log"; }
count_real_sessions() { sqlite3 "$REAL_DB" 'SELECT count(*) FROM session'; }

: > "$EVID/timeline.log"
: > "$EVID/isolation.log"
log "baseline real DB session count: $(count_real_sessions)"

# --- isolated XDG sandbox (per opencode-qa skill) ---
SANDBOX="$(mktemp -d -t momo-qa.XXXXXX)"
mkdir -p "$SANDBOX/data" "$SANDBOX/config" "$SANDBOX/cache" "$SANDBOX/state" "$SANDBOX/home" "$SANDBOX/proj"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"
export HOME="$SANDBOX/home"
export OPENCODE_TEST_HOME="$SANDBOX/home"
export OPENCODE_DISABLE_AUTOUPDATE=1
export OPENCODE_DISABLE_MODELS_FETCH=1
mkdir -p "$XDG_CONFIG_HOME/opencode"
printf '{\n  "plugin": ["file://%s/packages/omo-opencode/src/index.ts"]\n}\n' "$REPO" \
  > "$XDG_CONFIG_HOME/opencode/opencode.jsonc"
log "sandbox=$SANDBOX"

# --- Seed provider-models.json (catalog MCP data source) ---
SEED="/tmp/momo-p4-stdio-cache/oh-my-opencode/provider-models.json"
mkdir -p "$(dirname "$SEED")"
cat >"$SEED" <<'JSON'
{"models":{"openai":[{"id":"openai/gpt-5-nano","name":"GPT-5 Nano","context":200000,"output":16384,"tool_call":true},{"id":"openai/gpt-5-mini","name":"GPT-5 Mini","context":200000,"output":16384,"reasoning":true,"tool_call":true}],"google":[{"id":"google/gemini-flash","name":"Gemini Flash","context":1000000,"output":65536,"modalities":{"input":["image","text"]},"tool_call":true}]},"connected":["openai","google"],"updatedAt":"2026-08-24T00:00:00Z"}
JSON
mkdir -p "$XDG_CACHE_HOME/oh-my-opencode"
cp "$SEED" "$XDG_CACHE_HOME/oh-my-opencode/provider-models.json"
log "seeded catalog cache"

cd "$SANDBOX/proj"

# ============================================================================
# Task 3b - ROSTER (Bug B fix)
# ============================================================================
log "Task3b: bun dist/cli/index.js doctor --verbose"
bun "$REPO/dist/cli/index.js" doctor --verbose > "$EVID/doctor.local-fork-verbose.p4.txt" 2>&1
printf 'after-doctor: %s\n' "$(count_real_sessions)" >> "$EVID/isolation.log"
printf 'momo-roster hits: %s\n' "$(grep -c 'momo Roster & Catalog' "$EVID/doctor.local-fork-verbose.p4.txt")" >> "$EVID/isolation.log"
printf 'Total checks: %s\n' "$(grep -oE 'Total: [0-9]+ checks' "$EVID/doctor.local-fork-verbose.p4.txt")" >> "$EVID/isolation.log"

# ============================================================================
# Task 3a - ADVISOR (Bug A fix)
# ============================================================================
log "Task3a.1: boot dist and list runtime agent map"
node --input-type=module -e 'const [distUrl, projectDirectory] = process.argv.slice(1); const module = await import(distUrl); const hooks = await module.default.server({directory: projectDirectory, client: {}, serverUrl: new URL("http://127.0.0.1:1")}, {}); try { const config = {}; await hooks.config(config); const names = Object.keys(config.agent ?? {}).sort(); process.stdout.write(JSON.stringify({agentCount: names.length, agentNames: names, advisorRegistered: names.includes("advisor"), note: "empty sandbox; no session model so advisor is not registered; the delegation-time gate enforces unbound regardless"})); } finally { await hooks.dispose?.(); }' \
  "file://${REPO}/dist/index.js" "$SANDBOX/proj" \
  > "$EVID/3a.1-advisor-registration.json" 2> "$EVID/3a.1-advisor-registration.err"
cat "$EVID/3a.1-advisor-registration.json" >> "$EVID/isolation.log"

log "Task3a.2: delegation gate + advisor tool full cycle"
bun "$EVID/advisor-flow.probe.ts" \
  > "$EVID/3a.2-advisor-flow.jsonl" 2> "$EVID/3a.2-advisor-flow.err"

printf 'after-task3: %s\n' "$(count_real_sessions)" >> "$EVID/isolation.log"

printf 'final: %s\n' "$(count_real_sessions)" > "$EVID/isolation.final.p4.txt"
log "isolation: $(cat "$EVID/isolation.final.p4.txt")"

unset XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME XDG_STATE_HOME HOME OPENCODE_TEST_HOME