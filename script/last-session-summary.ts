#!/usr/bin/env bun
/**
 * last-session-summary.ts — momo / OpenCode son işlem özetleyici
 *
 * Terminalden çalıştırıldığında en son OpenCode / momo oturumunu analiz eder:
 * 1. Translator durumu (çevrilen metin, model, gecikme)
 * 2. Orkestratör oturumu (model, provider, maliyet, prompt cache hit oranı)
 * 3. Model Kataloğu (catalog_pick çağrıları ve seçilen modeller)
 * 4. Alt ajanlar (alt görevler, kullanılan modeller, maliyetler, yapılan işlemler)
 * 5. Nihai sonuç ve git dosya değişiklikleri
 *
 * Kullanım:
 *   bun script/last-session-summary.ts
 *   bun script/last-session-summary.ts --session <session_id>
 *   bun script/last-session-summary.ts --json
 */

import { Database } from "bun:sqlite"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

// ANSI Renk Kodları
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
}

interface TranslationLog {
  timestamp: string
  originalText: string
  translatedText: string
  model: string
  latencyMs: number
  skipped: boolean
}

interface SessionRow {
  id: string
  parent_id: string | null
  title: string
  model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  time_created: number
  time_updated: number
}

interface PartRow {
  id: string
  message_id: string
  session_id: string
  time_created: number
  data: string
}

function parseArgs(): { sessionId?: string; json: boolean; help: boolean } {
  const args = process.argv.slice(2)
  let sessionId: string | undefined
  let json = false
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--session" || arg === "-s") {
      sessionId = args[++i]
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--help" || arg === "-h") {
      help = true
    }
  }

  return { sessionId, json, help }
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec} sn`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return remSec > 0 ? `${min} dk ${remSec} sn` : `${min} dk`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString("tr-TR")
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

function getLatestTranslation(sessionTimeCreated: number): TranslationLog | null {
  const logDir = path.join(os.homedir(), ".omo", "local-translator-logs")
  if (!existsSync(logDir)) return null

  try {
    const files = readdirSync(logDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse()

    for (const file of files) {
      const filePath = path.join(logDir, file)
      const content = readFileSync(filePath, "utf-8").trim()
      if (!content) continue

      const lines = content.split("\n")
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (!line) continue
        try {
          const entry: TranslationLog = JSON.parse(line)
          const entryTime = new Date(entry.timestamp).getTime()
          // Oturum başlangıcından hemen önceki (veya ±60 saniye içindeki) çeviriyi bul
          if (Math.abs(sessionTimeCreated - entryTime) < 120_000 || entryTime <= sessionTimeCreated) {
            return entry
          }
        } catch {}
      }
    }
  } catch {}

  return null
}

function getGitStatus(): { statusLines: string[]; summary: string } {
  try {
    const res = spawnSync("git", ["status", "--short"], { encoding: "utf-8" })
    if (res.status !== 0) return { statusLines: [], summary: "" }
    const lines = (res.stdout || "").trim().split("\n").filter(Boolean)
    return { statusLines: lines, summary: lines.join(", ") }
  } catch {
    return { statusLines: [], summary: "" }
  }
}

function main() {
  const { sessionId: requestedId, json, help } = parseArgs()

  if (help) {
    console.log(`
${c.bold}momo / OpenCode Son İşlem Özetleyici${c.reset}

Kullanım:
  bun script/last-session-summary.ts [seçenekler]

Seçenekler:
  -s, --session <id>   Belirli bir session_id özetini gösterir (varsayılan: en son oturum)
  --json               Sonuçları JSON formatında verir
  -h, --help           Bu yardım mesajını gösterir
`)
    process.exit(0)
  }

  const dbPath = path.join(os.homedir(), ".local/share/opencode/opencode.db")
  if (!existsSync(dbPath)) {
    console.error(`${c.red}Hata: OpenCode veritabanı bulunamadı:${c.reset} ${dbPath}`)
    process.exit(1)
  }

  const db = new Database(dbPath, { readonly: true })

  // 1. Ana Oturumu Belirle
  let parentSession: SessionRow | null = null
  if (requestedId) {
    parentSession = db.query<SessionRow, [string]>(`SELECT * FROM session WHERE id = ?`).get(requestedId)
  } else {
    // En son ana oturumu bul (parent_id IS NULL)
    parentSession = db.query<SessionRow, []>(
      `SELECT * FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 1`
    ).get()
  }

  if (!parentSession) {
    console.error(`${c.red}Hata: İncelenecek oturum bulunamadı.${c.reset}`)
    process.exit(1)
  }

  // 2. Alt Ajan Oturumlarını Bul
  const childSessions = db.query<SessionRow, [string]>(
    `SELECT * FROM session WHERE parent_id = ? ORDER BY time_created ASC`
  ).all(parentSession.id)

  // 3. Oturum Parçalarını (Parts) Çek
  const parentParts = db.query<PartRow, [string]>(
    `SELECT * FROM part WHERE session_id = ? ORDER BY time_created ASC`
  ).all(parentSession.id)

  // Model Bilgisini Çözümle
  let parsedModel = { id: "bilinmiyor", providerID: "bilinmiyor" }
  if (parentSession.model) {
    try {
      parsedModel = JSON.parse(parentSession.model)
    } catch {}
  }

  // Translator Kaydını Bul
  const translation = getLatestTranslation(parentSession.time_created)

  // Catalog Pick Çağrılarını Bul
  interface CatalogPickCall {
    input: { need?: string; budget_profile?: string; task_complexity?: string }
    topPick?: { id?: string; provider?: string; reason?: string; description?: string }
  }
  const catalogPicks: CatalogPickCall[] = []

  // Kullanıcı Girdisi ve Nihai Çıktı
  let userPromptText = ""
  let assistantFinalText = ""

  for (const part of parentParts) {
    try {
      const data = JSON.parse(part.data)
      if (data.type === "text" && data.text) {
        if (!userPromptText) {
          userPromptText = data.text.trim()
        }
        assistantFinalText = data.text.trim()
      } else if (data.type === "tool" && (data.tool === "catalog_catalog_pick" || data.tool === "catalog_pick")) {
        const input = data.state?.input || {}
        let topPick: any = undefined
        try {
          const out = typeof data.state?.output === "string" ? JSON.parse(data.state.output) : data.state?.output
          if (Array.isArray(out?.picks) && out.picks.length > 0) {
            topPick = out.picks[0]
          }
        } catch {}
        catalogPicks.push({ input, topPick })
      }
    } catch {}
  }

  // Alt Ajanların Detaylarını Çek
  interface SubagentDetail {
    session: SessionRow
    model: { id: string; providerID: string }
    title: string
    categoryOrRole: string
    modifiedFiles: string[]
    lastTextSnippet: string
  }

  const subagents: SubagentDetail[] = childSessions.map((child) => {
    let childModel = { id: "bilinmiyor", providerID: "bilinmiyor" }
    if (child.model) {
      try {
        childModel = JSON.parse(child.model)
      } catch {}
    }

    const childParts = db.query<PartRow, [string]>(
      `SELECT * FROM part WHERE session_id = ? ORDER BY time_created ASC`
    ).all(child.id)

    const modifiedFiles = new Set<string>()
    let lastText = ""

    for (const p of childParts) {
      try {
        const d = JSON.parse(p.data)
        if (d.type === "tool" && (d.tool === "edit" || d.tool === "write" || d.tool === "apply_patch")) {
          const fp = d.state?.input?.filePath || d.state?.input?.targetFile
          if (fp) modifiedFiles.add(path.basename(fp))
        } else if (d.type === "text" && d.text) {
          lastText = d.text.trim()
        }
      } catch {}
    }

    // Role / kategori ayıkla
    let role = "worker"
    if (child.title.includes("(@")) {
      const match = child.title.match(/\(@([^\)]+)\)/)
      if (match) role = match[1]
    }

    return {
      session: child,
      model: childModel,
      title: child.title,
      categoryOrRole: role,
      modifiedFiles: Array.from(modifiedFiles),
      lastTextSnippet: lastText.slice(0, 160).replace(/\n/g, " "),
    }
  })

  // Token ve Cache Oranları
  const totalInputTokens = parentSession.tokens_input + parentSession.tokens_cache_read
  const cacheHitRatio = totalInputTokens > 0
    ? ((parentSession.tokens_cache_read / totalInputTokens) * 100).toFixed(1)
    : "0.0"

  const durationMs = parentSession.time_updated - parentSession.time_created

  // Git durumu
  const gitStatus = getGitStatus()

  // JSON Çıktısı İstenmişse
  if (json) {
    const output = {
      parentSession: {
        id: parentSession.id,
        title: parentSession.title,
        provider: parsedModel.providerID,
        model: parsedModel.id,
        cost: parentSession.cost,
        tokens: {
          input: parentSession.tokens_input,
          output: parentSession.tokens_output,
          reasoning: parentSession.tokens_reasoning,
          cacheRead: parentSession.tokens_cache_read,
          cacheHitRatioPercent: Number(cacheHitRatio),
        },
        durationMs,
        timeCreated: new Date(parentSession.time_created).toISOString(),
        timeUpdated: new Date(parentSession.time_updated).toISOString(),
      },
      translation,
      catalogPicks,
      subagents: subagents.map((s) => ({
        id: s.session.id,
        title: s.title,
        role: s.categoryOrRole,
        provider: s.model.providerID,
        model: s.model.id,
        cost: s.session.cost,
        tokensInput: s.session.tokens_input,
        tokensOutput: s.session.tokens_output,
        tokensCacheRead: s.session.tokens_cache_read,
        modifiedFiles: s.modifiedFiles,
        lastTextSnippet: s.lastTextSnippet,
      })),
      gitStatus: gitStatus.statusLines,
      finalResponse: assistantFinalText,
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  // Terminal UI Çıktısı
  const border = "═".repeat(70)
  console.log(`\n${c.cyan}${border}${c.reset}`)
  console.log(`${c.bold}${c.white}           MOMO / OPENCODE — SON İŞLEM ÖZETİ (SESSION SUMMARY)${c.reset}`)
  console.log(`${c.cyan}${border}${c.reset}\n`)

  // [1] TRANSLATOR
  console.log(`${c.bold}${c.magenta}[1] TRANSLATOR DURUMU (Local Translator)${c.reset}`)
  if (translation) {
    const lat = (translation.latencyMs / 1000).toFixed(1)
    console.log(`  ${c.dim}•${c.reset} Zaman:          ${c.yellow}${new Date(translation.timestamp).toLocaleTimeString("tr-TR")}${c.reset} (${lat}s gecikme)`)
    console.log(`  ${c.dim}•${c.reset} Model:          ${c.green}${translation.model}${c.reset} (Atlandı mı: ${translation.skipped ? "Evet" : "Hayır"})`)
    console.log(`  ${c.dim}•${c.reset} Orijinal Girdi: "${c.white}${translation.originalText}${c.reset}"`)
    console.log(`  ${c.dim}•${c.reset} Çevrilen Girdi: "${c.cyan}${translation.translatedText}${c.reset}"`)
  } else {
    console.log(`  ${c.dim}• Bu oturum için yerel translator kaydı bulunamadı (veya doğrudan İngilizce girildi).${c.reset}`)
    if (userPromptText) {
      console.log(`  ${c.dim}• Girdi:${c.reset} "${c.white}${userPromptText.slice(0, 140)}${userPromptText.length > 140 ? "..." : ""}${c.reset}"`)
    }
  }

  // [2] ORKESTRATÖR
  console.log(`\n${c.bold}${c.blue}[2] ORKESTRATÖR (Sisyphus / Main Agent)${c.reset}`)
  console.log(`  ${c.dim}•${c.reset} Oturum ID:      ${c.dim}${parentSession.id}${c.reset}`)
  console.log(`  ${c.dim}•${c.reset} Başlık:         ${c.bold}${parentSession.title}${c.reset}`)
  console.log(`  ${c.dim}•${c.reset} Model/Sağlayıcı:${c.green} ${parsedModel.providerID} / ${parsedModel.id}${c.reset}`)
  console.log(`  ${c.dim}•${c.reset} Süre:           ${formatDuration(durationMs)} (${new Date(parentSession.time_created).toLocaleTimeString("tr-TR")} -> ${new Date(parentSession.time_updated).toLocaleTimeString("tr-TR")})`)
  console.log(`  ${c.dim}•${c.reset} Token & Maliyet:`)
  console.log(`    - Giriş (Input):       ${formatTokens(parentSession.tokens_input)} token`)
  console.log(`    - Çıkış (Output):      ${formatTokens(parentSession.tokens_output)} token (+ ${formatTokens(parentSession.tokens_reasoning)} reasoning)`)
  console.log(`    - Cache Read (Hit):    ${c.bold}${c.green}${formatTokens(parentSession.tokens_cache_read)} token${c.reset} (${c.bold}%${cacheHitRatio}${c.reset} Cache Hit Oranı)`)
  console.log(`    - Oturum Maliyeti:     ${c.yellow}${formatCost(parentSession.cost)}${c.reset}`)

  // [3] MODEL KATALOĞU
  console.log(`\n${c.bold}${c.yellow}[3] MODEL KATALOĞU (catalog_pick)${c.reset}`)
  if (catalogPicks.length > 0) {
    catalogPicks.forEach((cp, idx) => {
      console.log(`  ${c.dim}• [Çağrı #${idx + 1}]${c.reset}`)
      console.log(`    - İhtiyaç (Need):    "${c.white}${cp.input.need || "Genel"}${c.reset}"`)
      console.log(`    - Bütçe / Zorluk:    ${cp.input.budget_profile || "balanced"} / ${cp.input.task_complexity || "moderate"}`)
      if (cp.topPick) {
        console.log(`    - Seçilen Model:     ${c.bold}${c.green}${cp.topPick.provider}/${cp.topPick.id}${c.reset} (${c.dim}${cp.topPick.reason || "optimal"}${c.reset})`)
      }
    })
  } else {
    console.log(`  ${c.dim}• Bu oturumda doğrudan catalog_pick çağrılmadı.${c.reset}`)
  }

  // [4] ALT AJANLAR
  console.log(`\n${c.bold}${c.green}[4] ALT AJANLAR (Subagent Delegations) — ${subagents.length} Ajan Çağrıldı${c.reset}`)
  if (subagents.length > 0) {
    subagents.forEach((sa, i) => {
      const isLast = i === subagents.length - 1
      const p1 = isLast ? "  └─" : "  ├─"
      const p2 = isLast ? "    " : "  │ "
      console.log(`${p1} ${c.bold}${i + 1}. ${sa.title}${c.reset}`)
      console.log(`${p2} ${c.dim}• Model:${c.reset}        ${c.green}${sa.model.providerID}/${sa.model.id}${c.reset}`)
      console.log(`${p2} ${c.dim}• Maliyet:${c.reset}      ${formatCost(sa.session.cost)} (Cache Read: ${formatTokens(sa.session.tokens_cache_read)})`)
      if (sa.modifiedFiles.length > 0) {
        console.log(`${p2} ${c.dim}• Değiştirilen:${c.reset} ${c.yellow}${sa.modifiedFiles.join(", ")}${c.reset}`)
      }
      if (sa.lastTextSnippet) {
        console.log(`${p2} ${c.dim}• Özet:${c.reset}         ${sa.lastTextSnippet}...`)
      }
    })
  } else {
    console.log(`  ${c.dim}• Alt ajan çalıştırılmadı (tek oturumda tamamlandı).${c.reset}`)
  }

  // [5] NİHAİ ÇIKTI & DEĞİŞEN DOSYALAR
  console.log(`\n${c.bold}${c.cyan}[5] NİHAİ SONUÇ & ÇALIŞMA DİZİNİ${c.reset}`)
  if (assistantFinalText) {
    const firstLines = assistantFinalText.split("\n").slice(0, 4).join("\n    ")
    console.log(`  ${c.dim}• Orkestratörün Son Yanıtı:${c.reset}`)
    console.log(`    ${c.white}${firstLines}${assistantFinalText.split("\n").length > 4 ? "..." : ""}${c.reset}`)
  }
  if (gitStatus.statusLines.length > 0) {
    console.log(`  ${c.dim}• Değiştirilen Dosyalar (git status):${c.reset}`)
    gitStatus.statusLines.slice(0, 8).forEach((line) => {
      console.log(`    ${c.yellow}${line}${c.reset}`)
    })
    if (gitStatus.statusLines.length > 8) {
      console.log(`    ${c.dim}...ve ${gitStatus.statusLines.length - 8} dosya daha${c.reset}`)
    }
  } else {
    console.log(`  ${c.dim}• Çalışma dizininde bekleyen dosya değişikliği yok (Clean).${c.reset}`)
  }

  console.log(`\n${c.cyan}${border}${c.reset}\n`)
}

main()
