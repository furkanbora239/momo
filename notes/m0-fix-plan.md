# M0 — Düzeltme Planı (V2 kırık temel sistemler)

**Tarih:** 2026-10-08 · **Girdi:** `momo_nots.md` §9 + §10 teşhis tabloları · **Durum:** PLAN, onay bekliyor
**İlke:** Her faz kendi yeşil barını ve kanıtını üretir; sonraki faz bir öncekin yeşil olmasına bakar.
**Ceza kuralı:** `packages/omo-opencode/src/AGENTS.md` gereği her değişiklik gerçek opencode'a karşı
QA edilir ve kanıt `.omo/evidence/<YYYYMMDD>-<slug>/` altına yazılır. "Typecheck geçti" QA değildir.

---

## Önce tek cümlelik kök haritası

| Belirti | Tek kök (kanıtlı) |
|---|---|
| Bg sonucu dönmüyor + watchdog yanlış "stale" (§9.1) | **V2 artık `session.idle` yaymıyor** (exam attempt 3/4 `seenEventTypes`'ta yok; V2 `session.execution.succeeded` yayıyor). Bitiş tespiti (`session-idle-event-handler.ts`) ve parent-wake flush (`settleAfterSessionIdle`) **yalnızca idle'a** bağlı → hiç tamamlanma yok → bildirim yok → 3 dk sonra watchdog "stale" diye iptal ediyor. |
| M2d eskasyon kaybı (§9.2) | Aynı zincirin parent-wake teslim tarafı (deferral + flush tetikleyicisi idle'a bağlı) — faz 1 ile birlikte çözülür. |
| Catalog/lsp MCP yok, `session_list` boş (§10.2, §10.6) | V2 yüzey türetmesi/kaydı eksik — ayrı kök, faz 2. |
| Prometheus/prompt kötü, çelişkiler (§9.6, §10.3) | Prompt derleme V1'den kalmış — ayrı kök, faz 3. |
| Test barı 17→38 (§9.4) | Bağımsız — her şeyin **öncesi**, çünkü yeşil bar olmadan hiçbir düzeltme güvenle doğrulanamaz. |

---

## Faz 0 — Yeşil barı geri al (GATE, her şeyden önce)

**Neden önce:** Sonraki her faz "hata seti büyümeden size HIV testi koşabileyim" diyecek; doğrulama zemini olmadan
hiçbir düzeltme güvenilir değil.

**İş:** `cd packages/omo-opencode && bun test` → **38 fail**. Her biri sınıflanır:
1. Bu dalın ürettiği gerçek regresyon (kaynak: bugünkü WIP diff / son 6 migration commit'i),
2. Çevre/makine bağımlı (disk/FS/order),
3. Gerçek pre-existing (prodüktör kodu dokunulmamış).

**Çıktı:** `notes/opencode-v2-migration-runbook.md` içinde numaralandırılmış triaj tablosu + **kabul edilen bar**
(hedef: bugünkü 38'in altına inmek, kalanı gerekçeli olarak işaretlemek).
**Kanıt:** sınıflandırma sonrası `bun test` çıktısı + her kategori için en az 1 commit-id.
**Boyut:** M · **Karar:** TAMİR (yeni yazım değil) — ama gerekçeyle "dokunulmadan bırak" listesi açıkça yazılır.

---

## Faz 1 — Bildirim / bitiş zinciri (EN KRİTİK)

**Kapsar:** §9.1 (bg sonucu dönmüyor, watchdog false-stale), §9.2 (M2d assert 4 eskasyon).
**Karar: BAŞTAN YAZIM.** Gerekçe: mekanizma V1'in `session.idle` varsayımı üzerine kurulu (deferral + flush +
`deliverImmediately` baypasları hep idle'a bağlı); V2'de karşılığı farklı bir olay modeli var. Yamalamak,
idle-dependent iki modülü (`session-idle-event-handler.ts`, `parent-wake-flush-runner.ts` +
`settleAfterSessionIdle`) her V2 değişiminde yeniden kırılgan bırakır.

**Adımlar:**
1. **Ölç (diag):** sandbox SSE aboneliği ile V2 hangi olayları yayıyor — `session.execution.succeeded`/
   `session.step.ended`/`session.execution.interrupted` setini kesin listele (exam'in `events-seen.json`'ı yeterli
   değilse yeni probe). `session.idle` yokluğunu **kanıtla**.
2. **Yeni bitiş tespiti:** V2 gerçeklerine göre tek kaynak (execution-succeeded + aynı stabilite penceresi).
   V1 `session.idle` kuyruğunu bu kaynağa bağla ki poller + parent-wake aynı sinyali görsün.
3. **Parent-wake teslimi baştan:** deferral/flush/idle-settle kavramlarını kaldır; V2 durumuna göre (busy/idle
   yerine V2 execution durumları) kuyruk + teslim yazılır. `deliverImmediately` kavramı ya gerekli olmaktan çıkar
   ya "acil wake" olarak tek yerde modellenir — WIP diff'i burada referans alınır, **taşınmaz**.
4. **Watchdog düzeltmesi:** üretim varken (çocuk çıktı üretmiş ama bitiş sinyali gelmemişse) "stale" demeden önce
   V2 bitiş durumunu yokla; yanlış iptal artık imkansız olmalı (regresyon testi ile kilitlenir).

**Kanıt kapısı:** exam attempt 5'te 4/4 assert (M2d) + canlı probe: bir bg görevin sonucu orchestrator'a
`<system-reminder>` ile döner ve task "running" takılı kalmaz (bg_6416da8b'nin birebir tekrarı geçmeli).
**Boyut:** L · **Bağımlılık:** Faz 0.

---

## Faz 2 — Yüzey: catalog/lsp MCP + oturum araçları

**Kapsar:** §10.2 (catalog MCP canlı yok; lsp oturum ortası drop), §10.6 (`session_list`/`session_read` boş).
**Karar: TAMİR + kayıt düzeltmesi** (kavram yanlış değil, kayıt/hedefleme yanlış) — ama önce ölçüm şart.

**Adımlar:**
1. Plugin init'inde `createBuiltinMcps()` sonrası hangi MCP araçlarının **oturum yüzeyine** çıktığını sandbox'ta
   listele; catalog/lsp nerede düşüyor: kayıt mı (MCP init), izin mi (M2a/M2b deny map'i), V2 tool-surface mi.
2. Catalog MCP araçlarını orchestrator yüzeyine geri getir. Kritik yan etki: sistem promptundaki
   **"catalog_pick MANDATORY" talimatı ancak o zaman uygulanabilir** olur (§10.2).
3. lsp: oturum ortası drop'un kaynağı (MCP yeniden bağlanma / client cache) belirlenir; drop tekrar etmemeli.
4. `session_list`/`session_read`: V1 `session` yerine V2 `session_v2` + `session_message` okunur (§10.7 şeması).

**Kanıt kapısı:** sandbox + canlı: `catalog_list` orchestrator yüzeyinde görünür ve sonuç döner; `lsp` MCP oturum
boyunca stabil; `session_list` bugünün V2 oturumlarını listeler.
**Boyut:** M · **Bağımlılık:** Faz 0. Faz 1 ile paralel koşabilir (farklı kök).

---

## Faz 3 — Prompt bütünlüğü (orchestrator + derleme)

**Kapsar:** §9.6, §10.3. **Karar: BAŞTAN YAZIM.** Gerekçe: prompt gövdeleri V1 döneminden kalma ölü referanslarla
(`todowrite`, V1 araç adları, disabled roster'a canlı referans), üç farklı delege eşiği (kendi içinde çelişkili) ve
3x tekrarlanan talimat bloklarıyla dolu; bunları tek tek yamalamak yerine V2 yüzeyi için tek gövde yazılır.

**Adımlar:**
1. `packages/omo-opencode/src/agents/sisyphus/*.ts` gövdelerinden ölü referansları ayıkla: `todowrite`,
   `lsp_diagnostics`, V1 isimleri, Oracle/prometheus/metis/momus/hephaestus/atlas canlı referansları.
2. Tek delege eşiği, tek "baştan entities" kuralı; tekrar eden bloklar birleştirilir (token maliyeti düşer).
3. `dist` ↔ kaynak prompt eşitsizliğini (dist bundle prompt content testi) kapat; varyant seçimi (model family)
   doğrulanır.
4. Faz 2 bitmeden **catalog_pick MANDATORY** satırı yazılamaz — ya araç gelir ya satır kaldırılır (koordinasyon).

**Kanıt kapısı:** canlı TUI'da orchestrator prompt'unun V2 yüzeyiyle tutarlı olduğu (ölü araç referansı yok) +
ilgili prompt/dist testleri yeşil.
**Boyut:** M · **Bağımlılık:** Faz 0 (+ faz 2 ile satır bazında koordinasyon).

---

## Faz 4 — Todo kararı (kullanıcı onaylı mimari karar)

**Kapsar:** §9.3. V2 ajan `todowrite`'ı kaldırdı → momo'nun todo-continuation/todo-sync/boulder zinciri üreticisiz.
İki seçenek, kullanıcı seçer:
- **(A) Yeniden besle:** plugin V2 `/session/{id}/todo` API'sine yazar → `todo.updated` doğar, zincir yaşar.
- **(B) Emekli et:** ajan-todo takibi V2 altında kaldırılır; ilgili hook'lar (todo-continuation-enforcer,
  todo-sync, tasksTodowriteDisabler) ve prompt bölümleri çıkarılır. Token ve karmaşa azalır.

**Boyut:** S (B) / M (A) · **Karar bekleniyor.**

---## Faz 5 — Kapanış

1. Runbook + `PROJECT_STATE.md` + `AGENTS.md` güncellemeleri: opcode sürümü 2.0.25, phase durumları, M0 göçü.
2. PR: `fix/opencode-v2-plugin-migration` → `dev`, fazların kapı kanıtları PR gövdesinde.
**Boyut:** S.

---

## Toplu sıra (bağımlılık sırası)

```
Faz 0 (yeşil bar)  →  ┌ Faz 1 (bildirim zinciri — KRİTİK, baştan yazım)
                      └ Faz 2 (yüzey/araçlar — tamir)      [paralel]
                              ↓
                      Faz 3 (prompt — baştan yazım)
                              ↓
                      Faz 4 (todo kararı)  →  Faz 5 (kapanış/PR)
```

**İlk hamle önerisi:** Faz 0 triajı — yarım günlük iş, sonrası için zemin. Ardından Faz 1 ölçüm adımı
(V2'nin hangi olayları yaydığını kesin listeleme) tek başına bile kafa karışıklığını bitirir.
