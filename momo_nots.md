# momo_nots.md — Orkestrasyon Sorun Raporu

Bu dosya, OKX agent server geliştirme oturumunda (2026-09-12) orkestratör olarak yaşanan
alt ajan / altyapı sorunlarını belgeler. Düzeltme çalışması için not. **Commit edilmeyecek.**

---

## 1. Provider / Bakiye Sorunları

### 1.1 go-b (Havuz B) bakiyesiz havuza iş yönlendirme
- **Semptom:** İlk Faz 1 görevi `go-b/deepseek-v4-pro` modeline gitti; oturum `ses_f6b5c0eb4ffef3VpvV2XFK5HDa`
  2 kez "stalled (no activity for 3min)" ile öldü, 3. devam denemesi de takıldı.
- **Kök neden:** go-b bakiyesi bitmişti (kullanıcı onayladı). `catalog_pick` hâlâ go-b'yi
  "budget tier, en ucuz" olarak başa koyuyordu → manager otomatik seçimde ölü havuza gidebiliyordu.
- **Müdahale:** `~/.config/opencode/opencode.json` içine `"disabled_providers": ["go-b"]` eklendi.
- **SORUN 1:** Katalog, provider ölü/bakiyesiz olduktan sonra da onu listelemeye devam ediyor.
  Manager ölü provider'ı otomatik seçebilir. **İstek:** katalog, provider sağlık/bakiye durumunu
  yansıtsın veya ölü provider'a task yönlendirmesi anlamlı bir hatayla başarısız olsun (3dk sessizlik yerine).
- **SORUN 2:** `disabled_providers` config değişikliği ancak opencode yeniden başlatıldığında etkin.
  Çalışan oturumda manager hâlâ devre dışı bırakılan provider'ı görebiliyor.

### 1.2 Model routing karışıklığı
- Task sonuçlarında uyarı: "parent used opencode-go/glm-5.3-flash, this subagent used
  neuralwatt/deepseek-v4-flash (via category: deep)". Task() çağrısında **açık model parametresi**
  verilmese de category bazlı routing devreye giriyor; orchestrator'ın model tercihi ile
  category default'u arasında sessiz override riski var.

---

## 2. Stall Dedektörü Sorunları

### 2.1 3 dakikalık sessizlik = ölüm (yanlış pozitifler)
- **Semptom:** Worker uzun dosya üretimi veya uzun düşünme bloğu sırasında 3 dk araç çağrısı
  yapmazsa "subagent stalled (no activity for 3min while session was busy with no active tool)"
  ile öldürülüyor.
- **Etkilenen durumlar:** deepseek-v4-pro'nun uzun üretim tarzı (tek seferde büyük dosya yazımı)
  dedektörü tetikliyor. Faz 1-2'de worker'lar tam da üretim fazlasındayken kesildi.
- **Workaround (işe yaradı):** Her worker prompt'una "araç çağrıları arasında 2 dakikadan fazla
  kalma; modüller arası `npm run typecheck` koştur (bu da aktivite sayar)" talimatı ekledim.
- **İstek:** Dedektör eşiği yapılandırılabilir olsun veya worker'ın hâlâ "busy with no active
  tool" durumunda *üretim* yaptığını (stream'de token akışı var) ayırt etsin. Token akışı olan
  bir worker "stalled" değildir.

### 2.2 Belirsiz abort mesajları — üç farklı hata, üç farklı sebep
- Gözlenen mesajlar: `Task aborted.` / `Tool execution aborted` / `subagent stalled (...)`.
- Hangisinin stall dedektöründen, hangisinin kullanıcı iptalinden, hangisinin provider
  hatasından geldiği ayırt edilemiyor. Faz 1 fresh task'ı ~20 dk çalışıp TÜM dosyaları yazdıktan
  sonra "Tool execution aborted" aldı — gerçek sebebini bugün de bilmiyoruz.
- **İstek:** Abort sebebi mesajda açık olsun (stall_detector | user_cancel | provider_error | timeout).

---

## 3. Oturum Durumu Sorunları

### 3.1 Devam (continuation) oturumlarının bozulması
- Faz 5 worker'ı (ses_f6b18ddd3ffeepPc4dlgbyv6P9) Faz 5'te 1m52s'de yarı-edit durumda döndü
  (ws.ts tip hatasının ortasında). Faz 7'de AYNI oturum 3 kez üst üste **~30 saniyede kesildi**
  (31s, 31s, 32s) — worker hiçbir iş yapamadan dönüyordu.
- **Çözüm:** Taze oturum + kendi kendine yeten (self-contained) kapsamlı prompt → Faz 7 bir
  taze oturumda 18dk40s'de sorunsuz bitti.
- **Öğrenme:** Uzun yaşayan worker oturumları (Faz 2→7 aynı session) bir noktada "bozuluyor";
  ~30s'de kesilen continuation'larda oturumu terk et, taze oturum aç.
- **İstek:** Continuation'ın neden erken döndüğü loglanmıyor; "task completed in 31s" görünüyor
  ama gerçekte worker yarı yolda. Tamamlanma oranı / kesilme sebebi raporlansın.

### 3.2 Task geri dönüşü worker'ın yarısında — sonuç state'i kayıp
- Faz 4 continuation'ı worker hâlâ debugging yaparken döndü (sonuç yerine worker'ın
  DÜŞÜNCESİ geldi: "let me update the repo..."). Faz 5'te de yarı yazılmış ws.ts kaldı.
- **İstek:** Task, worker'ın aktif bir araç çağrısının ortasındaysa sonucu dönme; ya bekleyip
  doğal durakta dön ya da "incomplete" bayrağıyla dön.

### 3.3 Subagent oturumu compaction şablon doğrulamasında ölüyor
- **Semptom:** Uzun süren bir worker oturumu (M2d canlı sınavı) `task(task_id=...)` ile devam
  ettirilirken oturum `error` ile sonlandı: "Compaction summary did not match the required
  template". Görev yarım kaldı - ne verdict ne kanıt üretildi.
- **SORUN:** Compaction özeti şablon doğrulamasından geçmeyince oturum kurtarılamıyor; devam
  çağrısı da aynı hatayla ölüyor. §3.1'deki "uzun yaşayan worker oturumu bozuluyor" durumunun
  yeni bir görünümü.
- **İşlenme:** Taze oturum + self-contained prompt ile sürdürüldü (§5.2 öğrenmesi).
- **İstek:** Şablon doğrulaması başarısızsa compaction geri alınsın (retry veya ham özetle devam) -
  oturum ölümüne yol açmasın; hata mesajı eksik/kötü gelen alanı tarif etsin.

---

## 4. Harness / Araç Sorunları

### 4.1 Yorum/docstring hook'u (comment-detector)
- Her `edit` çağrısında comment/docstring tespit edilince zorunlu açıklama isteyen hook tetiklendi
  (5+ kez). Mevcut dosya konvansiyonuna uygun (örn. numaralı boot adımları) veya sözleşme
  belirten (public API davranışı) yorumlar için bile manuel gerekçe yazdırdı — üretkenliği düşürdü.
- **İstek:** Hook yalnızca gerçekten gereksiz yorumları işaretlesin veya top-level config ile
  ayarlanabilir/kapatılabilir olsun.

### 4.2 tool-output cap'i worker raporlarını kesiyor
- `background_output` ve uzun tool sonuçları 8000 karakterde kesiliyor ("output truncated by
  momo tool-output cap"). Worker'ın Faz 3-5 raporlarının sonları (deviations, verify bölümleri)
  kayboldu; tam rapor için ikinci çağrı gerekti.
- **İstek:** Rapor kırpılan yerde "... (devamı için task_id)" işaretini SAYFALANABİLİR yapar
  (offset parametresi) — şu an sadece kestiği görünüyor.

### 4.3 Codegraph MCP timeout
- Oturum başında `codegraph_status` MCP error -32001 (Request timed out) döndü; doğrudan
  Read/Grep'e düştüm. Index yoksa hızlı ve net bir "no index" hatası daha iyi.

### 4.4 Background task raporlama güvenilirliği (pozitif geri bildirim)
- `run_in_background=true` + completion notification kalibi PARALEL doc görevlerinde (4 görev,
  2.5-7dk) mükemmel çalıştı: kullanıcı görünürlük aldı, orchestrator beklemedi, çakışma yok.
- **İstek:** Uzun SYNC task'lar için de (18-30dk süren faz işleri) aynı görünürlük: worker'ın
  yazdığı son dosya / son araç çağrısı gibi hafif bir heartbeat kaydı.

---

## 5. Süreç Öğrenmeleri (tekrarlanabilir kalıplar)

1. **"Aborted" ≠ "iş yok"**: Kesilen worker'ların diske yazdığı dosyalar sağlam çıktı (Faz 1 ve
   Faz 2'de neredeyse tüm modüller diskteydi). Her abort sonrası `git status` + dosya taraması
   yap — işin çoğunu kurtarabilirsin.
2. **Self-contained prompt > oturum continuation**: Taze oturuma taşınabilir, tam sözleşmeli
   prompt (TASK/CONTEXT/MUST DO/MUST NOT DO/VERIFY) tek başına yeterliydi; DESIGN.md binding
   spec olarak bu kalıbın yükünü hafifletti.
3. **Orkestratör doğrulaması şart**: Worker "tamamlandı" dedi 5 vakada da benim koşturduğum
   typecheck/test/boot ek gerçek hata buldu (tip hataları, mantık bug'ı: listUncompressed en eski
   6 adımı döndürüyordu, spec "son 6" diyordu).
4. **`git add -A` ilk commit'te tuzak**: İlk commit ("scaffold") subagent'ın bitmiş Faz 1
   dosyalarını da swept — mesaj/içerik uyuşmazlığı. Faz çalışırken commit atılacağı zaman
   dosya bazlı seçim yap.
5. **Paylaşılan integration dosyaları** (server.ts, index.ts) çoklu faz tarafından değişince
   faz-bazlı commit ve buildable ara commit hedefi çatışıyor — hub dosyaları son faz commit'ine
   koymak ya da hunk-bazlı staging gerekiyor.

---

## 6. Çevre Sorunları (kullanıcı çözümü)

- **Docker Desktop daemon başlamadı** (servis active ama docker.sock hiç oluşmadı, ~3dk beklemeye
  rağmen). Kullanıcı kendisi çözdü; sonrasında `docker compose build/up` sorunsuz.
- **pnpm yok** (npm 10.9.4 + node v22): workspace `file:` bağımlılığı npm ile kuruldu;
  core'un transitive bağımlılıkları (smol-toml, undici, yauzl) server package.json'a da
  eklenerek çözünürlük garanti altına alındı.

---

## 7. Özet — düzeltilmesi istenen davranışlar (öncelik sırasıyla)

| # | İstek | Etki |
|---|---|---|
| 1 | Stall dedektörü token-akışını sayarak uzun üretimde yanlış pozitif vermesin | 4 görevde yanlış abort |
| 2 | Provider sağlık/bakiyesi katalogda görünmesin ve ölü providera yönlendirme net hata versin | 1 görev tam kayıp |
| 3 | Abort sebebi açık olsun (stall/user/provider/timeout) | Debug süresi ↓ |
| 4 | Continuation oturumu ~30s'de kesilme durumu: oturum "poisoned" işaretlenip taze oturum önerilsin | 3 başarısız devam denemesi |
| 5 | tool-output cap sayfalanabilir olsun | Rapor kaybı |
| 6 | Comment hook top-level config ile yönetilsin | Üretkenlik |
| 7 | Worker'lara temel araç erişimi (codegraph, web search, skill) açılsın | Subagent keşif/tool kısıtı |
| 8 | Worker'lar orkestratöre soru sorabilsin (kullanıcıya eskalasyon fallback) | Bağlamsız kullanıcı kararları |

---

## 8. Worker Tool Erişimi ve Soru Yöneltme (2026-10-05, opencode-v2 QA oturumu)

Kaynak: `fix/opencode-v2-plugin-migration` dalında M1d sandbox QA görevi — subagent `worker`,
model `opencode-go/hy3`, oturum `ses_ef4edede9ffeYWd4VhUDx8U5Ya`.

### 8.1 Worker'lar temel tool'lara erişemiyor
- **Semptom:** Worker'a "opencode-qa skill'ini skill tool ile yükle" talimatı verildi; worker
  "I don't have a skill tool in my available functions" diyerek kullanıcıya soru sordu
  ("Tool Access" dialog, 3 seçenek). Bildirdiği fonksiyonlar: `shell, read, write, edit,
  execute, webfetch, websearch, question`.
- **SORUN:** Subagent tool yüzeyi dar — skill tool yok, codegraph gibi temel keşif araçları yok.
  `task()` (delegate-task) `load_skills` ile skill içeriği taşıyabiliyor ama spawn yüzeyi
  child'a skill aracı vermiyor; "skill tool ile yükle" talimatı bu yüzden karşılanamıyor.
- **İstek:** Worker'lara varsayılan temel araç seti açılsın: **codegraph** (search/context/explore),
  **web search** (websearch/webfetch), **skill erişimi** (skill tool ya da spawn'ta skill
  içeriği enjeksiyonu) + diğer salt-okunur keşif araçları. Ağır/yazma araçları (build, push,
  publish) kısıtlı kalabilir.
- **Geçici çözüm (bu QA'da işe yaradı):** "Use shell to invoke skill" — worker skill
  dosyalarını shell/read ile okudu. Orkestrasyon sözleşmesini bozuyor, kalıcı çözüm değil.

### 8.2 Soru kanalı tek yönlü: worker -> kullanıcı var, worker -> orkestratör yok
- **Semptom:** Aynı worker sorusunu `question` tool'u ile doğrudan kullanıcıya sordu; cevap
  kullanıcıdan geldi ("Use shell to invoke skill"). Sorunun ne istediğini anlamak için ayrıca
  orkestratöre sorulması gerekti — soru bağlamı orkestratörde değildi.
- **SORUN:** Worker, plan bağlamını taşıyan orkestratöre soru soramıyor; her ara karar
  kullanıcıya gidiyor ve kullanıcı bu dialog'ları bağlamsız cevaplamak zorunda kalıyor.
- **İstek:** Worker'lar orkestratöre soru sorabilsin. Tercih edilen akış: worker sorusu →
  orkestratör (plan bağlamıyla cevaplar) → yalnızca orkestratör karar veremiyorsa kullanıcıya
  eskalasyon.
- **Önerilen şekil:** `question` tool'una hedef alanı (`orchestrator` varsayılan | `user` açık
  eskalasyon); bekleyen sorunun orkestratör tarafında event olarak akması ve
  `task(task_id=..., answer)` ile cevaplanabilmesi; cevap N saniye gelmezse kullanıcıya düşmesi.

---

## 9. V2 Altında Kırık Temel Sistemler (2026-10-08, canlı doğrulama oturumu)

Kaynak: canlı TUI oturumu (glm-5.3 orchestrator) + sandbox M2d attempt 4 + gerçek DB
(salt-okunur) incelemesi. Kullanıcı beyanı: "en önemli özellikler çalışmıyor, ajan
promptları kötü durumda, her şey birbirine girmiş, manager çalışmıyor."

### 9.1 Arka plan görevi sonucu orchestrator'a DÖNMÜYOR (en kritik)
- **Kanıt (canlı):** `task(subagent_type="manager")` probe'u (bg_6416da8b) — Jev doğru
  route etti (explorer), alt ajan 14:37:44'te raporu tamamladı (HEALTHY dahil), ama
  orchestrator'a `<system-reminder>` hiç gelmedi; task durumu 5+ dk sonra hâlâ
  "running". Bitiş tespiti/bildirim zinciri V2 altında kırık.
- **Etki:** Tüm orkestrasyon kör — kullanıcı açısından "manager hiçbir şey yapmıyor".
- **Şüpheli zincir:** V2 tamamlanma olayı (`session.execution.succeeded`) → V1 `session.idle`
  eşlemesi eksik VEYA parent-wake teslim zinciri (ertelenmiş kuyruk + flush tetikleyicisi)
  sıkışık. M2d assert 4 (eskasyon kaybı) ile aynı zincir — tek kök olası.
- **İKİNCİ KANIT (aynı probe):** Tamamlanma bildirimi gelmeyince 3 dk sonra stall watchdog
  görevi **"Stale timeout" ile İPTAL etti** (sonuç üretildiği halde yanlış karar) — yani
  zincir kırılmakla kalmıyor, watchdog kırığı "stale" diye yeniden etiketliyor ve üretimi
  gizliyor. Tam zincir: çocuk bitti → idle tespiti yok → bildirim yok → watchdog iptali →
  sonuç kaybı (içerik child oturumunda duruyor).

### 9.2 M2d question routing — assert 4 (eskale edilmeyen soru)
- **Durum:** attempt 4 (bugün) — assert 1-2-3 GEÇTİ (form `/api/api` ikiye katlanma
  düzeltmesi + form field `key`/`id` alias işe yaradı; çocuk cevapla devam ediyor).
  Sadece assert 4 düşüyor: yanıtlanmayan soru 120s sonra kullanıcıya eskale etmiyor.
- **Kanıt:** timer kuruluyor (`routeChildQuestion` → setTimeout), hata logu yok — sessiz
  kayıp `queuePendingParentWake` zincirinde (`deliverImmediately` bypass'ı yarım).
- **Ek bulgu:** `[subagent-question-router] event subscription failed: result.stream
  undefined` (ikincil yol; ana routing plugin hook'tan çalışıyor).

### 9.3 V2'de ajan `todowrite` aracı YOK — todo zinciri üreticisiz (ölü kod)
- **Kanıt:** v2 binary migration kodu: "todowrite ... no longer available and must
  not be called". Canlı yüzey doğrulaması: orchestrator (glm-5.3) Code Mode kataloğunda
  todo aracı yok; DB `todo` tablosunda 2 Ekim'den (V2 geçişi) beri tek satır yok.
- **Etki:** momo'nun todo-continuation / todo-sync / boulder takip zinciri V2 altında
  üreticisiz. Kullanıcı "flash modele görev listesi yaptır" dedi → model araç bulamadı,
  TUI'da hiçbir şey görünmedi (beklenen davranış, momo hatası değil ama yetenek kaybı).
- **Karar gerekli:** ya plugin `/session/{id}/todo` API'sinden yazar, ya ajan-todo
  takibi V2 altında emekli edilir.
- **Runbook düzeltmesi:** "todo.updated canlı emisyonu doğrulanmadı" maddesi yanlış
  framed — olay ajan todowrite'ından hiç gelemaz.

### 9.4 Test barı çürüyor: 17 → 38 hata
- Runbook'un belgelediği bar 9280 pass / 17 fail; bugün 9273 pass / **38 fail**.
- Yeni düşenler: M2b manifest drift guard (3), dist bundle prompt içerik (kaynak ≠
  bundle), createBuiltinAgents (2: custom ajan prompt reklamı + disabledAgents hariç
  tutma), shared-skills manifest (3), builtin skill ekstraksiyonu, GPT-5.5 model ailesi
  referansı, CLI/TUI installer (2) — V1/V2 karışımı belirgin.
- **"Pre-existing, dokunulmadı" belgeleme stratejisi artık geçersiz:** hata seti
  büyüyor; M0a triajı şart.

### 9.5 Kurulu opencode v2.0.23 değil v2.0.25
- Runbook 2.0.23 diyor; `opencode --version` = **v2.0.25**. Runbook + pinned
  `@opencode/client`/`protocol` 2.0.22 notları güncellenmeli.

### 9.6 Kullanıcı algısı: "ajan promptları kötü"
- Somut kök adayları: dist prompt eşitsizliği (bundle ≠ kaynak), createBuiltinAgents
  prompt derleme hataları, 38 hatalı bar içinde prompt-related testler. M0c maddesi.

### Öncelik sırası (öneri)
| # | Madde | Neden önce |
|---|---|---|
| 1 | 9.1 bildirim/bitirme zinciri | Tüm orkestrasyon kör; diğer her şey bunun arkasında |
| 2 | 9.4 test triajı | Yeşil bar olmadan hiçbir düzeltme güvenle doğrulanamaz |
| 3 | 9.2 M2d assert 4 | 9.1 ile aynı zincir olabilir — ortak kök aramak |
| 4 | 9.6 + 9.4 prompt bütünlüğü | Kullanıcı deneyimi |
| 5 | 9.3 todo kararı | Mimari karar, kullanıcı onaylı |
| 6 | 9.5 dok güncelleme | Ucuz, her an |

**Baştan yazma adayları (kullanıcı önerisi: "bazı şeyleri düzeltmek baştan yapmaktan
daha zor"):** parent-wake/notification teslim zinciri (9.1+9.2 birlikte, deferral +
flush + deliverImmediately kavramaları V1 kalıntısıyla V2 gerçeklerine uymuyor);
todo-devam zinciri (V2 gerçeklerine göre tasarımla); M3 markdown agents zaten
"baştan yazım" karakterli (M0'dan sonra M3'ü erken çekmek mantıklı olabilir).

---

## 10. Teşhis Turu 2 — Manager/Jev, Katalog MCP, Sistem Prompt (2026-10-08, canlı)

Kullanıcı talimatı: önce tam teşhis + not; düzeltme planı sonra. "Task işlevsiz,
manager route yapıyor fakat bilinçli mi, doğru modelle mi yönlendiriyor bilmiyoruz."

### 10.1 Manager/Jev: BİLİNÇLİ çalışıyor (kanıtlı) — iki açık alt-soru
- **Kanıt (decision ledger, tek kayıt):** bg_6416da8b probe'u için stage1 path=explore
  güven **0.91** (eşik 0.75 üstü), stage2 model=**opencode/big-pickle** güven **0.97**
  (olasılıklar: big-pickle 0.98, glm-5.3-flash 0.02), lane=direct-worker, effort=1.
  Candidate havuzu 6 model, fiyat sıralı (big-pickle + 5 flash). Maliyet $0.00006.
- **Yorum:** "Beleş modele mi gitti?" — EVET ve bilinçli: önemsiz read-only görev için
  en ucuz yeterli model Jev kararıyla seçildi. Momonun kuzey yıldızı gereği doğru.
- **Açık alt-soru 1:** Aynı milisaniyede `engine.decide threw "jev down"` fallback'i de
  var — çift route() çağrısı olmuş (biri Jev başarı → dispatch ondan; ikincisi "jev
  down" fallback, kaydı disk sorunuyla patladı). Çift çağrının kaynağı belirsiz.
- **Açık alt-soru 2:** "jev down" tek seferlik mi (Zen endpoint ayakta, 0.97 güvenle
  cevapladı) yoksa kırılgan mı — sağlım gerekli.

### 10.2 Model-catalog MCP CANLI YÜZEYDE YOK (kırık temel özellik)
- **Kanıt:** Code Mode kataloğunda `catalog_*` araçları yok (arama teyit); canlı MCP
  listesinde **yalnızca appwrite**. Momonun Tier-1 builtin'i (catalog_list/pick/
  refresh/knowledge/enrich) orchestrator yüzeyine hiç ulaşmıyor.
- **Etki (KRİTİK):** Sistem promptundaki "CATALOG-FIRST MODEL CHOICE MANDATORY —
  before EVERY task() call catalog_pick" talimatı **yerine getirilemez** (araç yok);
  her delege katalogsuz yapılıyor. 8 adet "env-dependent" catalog MCP test hatası ile
  tutarlı — test hatası değil, canlı kayıt kırığı olabilir.
- **`lsp` MCP de yüzeyden düşmüş:** oturum başındaki Code Mode kataloğunda 8 lsp
  aracı vardı; son katalogda yok. Oturum ortası yüzey değişimi — MCP araç drop'u.

### 10.3 Sistem prompt kalitesi: "ajan promptları kötü" beyanı KANITLI
Orchestrator (glm-5.3) kendi sistem promptunu inceledi; somut kusurlar:
- **Ölü V1 referansları:** `todowrite` talimatları (araç V2'de yok — 9.3), bash/task
  V1 isimleri, `lsp_diagnostics`, todo-continuation ("TODO CREATION TRACKED BY HOOK").
- **Uygulanamaz zorunluluklar:** "catalog_pick MANDATORY" (araç yok — 10.2), "Oracle
  running → cevabı bekle" + "CONSULT Oracle" (oracle ajanı Phase A'da disabled);
  disabled roster (prometheus/metis/momus/hephaestus/atlas/oracle) promptta canlı
  referans olarak duruyor.
- **İç çelişkiler:** aynı delege kararı için 3 farklı eşik ("handful of tool calls →
  kendin yap" vs "NEVER implement substantive work yourself" vs "trivial edits only");
  "OVER-DELEGATION counterweight" vs "HARD DELEGATION MANDATE NON-NEGOTIABLE".
- **3x tekrar:** aynı ilkeler (lead-with-outcome, no-narration, ter silence) Role/
  behavior/momo_core/ponytail bölümlerinde tekrar tekrar — token şişkinliği.

### 10.4 TUI/sidebar: askıdaki görev "running" gösteriliyor
- 9.1'in yüzey belirtisi: bitmiş-ama-bildirilmemiş görev sidebar'da sürekli running.
  Kök 9.1 + tui.json entry yazmama hatası (9.4 içindeki createPluginModule hataları).

### 10.5 Disk block-accounting (KAPALI — kullanıcı çözdü)
- "disk full" ledger hatası gerçekmiş (blok hesabı) ama kullanıcı halletti; disk
  dolu değil (29G boş). Takip gerekmiyor.

### Teşhis turu özeti (düzeltme planlama girdisi)
| # | Bulgu | Durum | Önem |
|---|---|---|---|
| 1 | Bg sonucu orchestrator'a dönmüyor + watchdog yanlış stale (9.1) | Kanıtlı | Kritik |
| 2 | Catalog MCP canlıda yok; catalog_pick zorunluluğu uygulanamaz (10.2) | Kanıtlı | Kritik |
| 3 | lsp MCP oturum ortası drop (10.2) | Kanıtlı | Yüksek |
| 4 | Sistem prompt: ölü referanslar + çelişkiler + tekrar (10.3) | Kanıtlı | Yüksek |
| 5 | M2d assert 4 eskasyon kaybı (9.2) | Kanıtlı | Yüksek |
| 6 | Test barı 17→38 (9.4) | Kanıtlı | Yüksek |
| 7 | Todo zinciri üreticisiz, V2 kararı gerekli (9.3) | Kanıtlı | Orta |
| 8 | Jev çift route çağrısı + "jev down" sağlığı (10.1) | Açık soru | Orta |
| 9 | TUI sidebar running-takılı + tui.json (10.4) | Kanıtlı | Orta |
| 10 | opencode 2.0.25 sürüm kayması (9.5) | Kanıtlı | Düşük |

### 10.6 `session_list` / `session_read` oturum araçları V2 altında bozuk (EK)
- **Semptom (canlı):** `session_list` (limit/project filtreli ve filtresiz) → "No
  sessions found"; oysa DB'de bugünün oturumları dolu (session_v2 tablosunda 6+ canlı
  kayıt). V1 `session` tablosu bayat (son kayıt 2026-10-03) — araç V1 tabloyu okuyor,
  V2 `session_v2`'yi değil.
- **Kanıt:** `sqlite3 ~/.local/share/opencode/opencode.db` → `session` son 2026-10-03,
  `session_v2` bugün dolu; `todo` tablosu 2026-10-02'den beri boş.
- **Kök:** oturum araçları V2 şemasına (`session_v2` + `session_message`, `data` JSON
  kolonları) taşınmamış — M6 köprü süpürmesine aday.

### 10.7 Kanıt noktaları indeksi (sonraki ajan için — sıfırdan kazma)
| Ne | Nerede | Not |
|---|---|---|
| Canlı plugin logu | `/tmp/oh-my-opencode.log` | decision-router, question-router, v2-*-bridge satırları |
| Gerçek DB (SALT-OKUNUR!) | `~/.local/share/opencode/opencode.db` | tablolar: `session_v2` (canlı), `session` (V1, bayat), `session_message` (mesajlar, `data` JSON), `todo` (2 Ekim'den beri boş) |
| Karar defteri | `~/.omo/decision-ledger.jsonl` | Jev kararları (stage1/stage2/resolved/usage) |
| M2d sınav kanıtı | `.omo/evidence/20261005-m2d-question-routing/` | summary.md, plugin-log-m2d.log, q2-timing.json |
| Canlı probe kaydı | bg_6416da8b / çocuk `ses_ee40d449affecbINbuhuOySekb` | 9.1'in kanıtı; çocuk mesajlarında HEALTHY raporu duruyor |
| Flash-model todo testi | kullanıcı oturumu, 2026-10-08 ~16:50 | 9.3'ün tetikleyicisi (ajan todo aracı yoktu) |
| WIP diff (M2d deliverImmediately) | `git diff` — manager.ts, subagent-question-router.ts, plugin/tool-execute-before.ts, parent-wake-* zinciri | runbook madde 34'te dosya listesi |
| Runbook (plan) | `notes/opencode-v2-migration-runbook.md` | 2026-10-08 güncellemesi §9'ye bağlı |
| Test barı | `cd packages/omo-opencode && bun test` → 9273 pass / 38 fail (2026-10-08) | 9.4'te hata listesi |

**Durum: TEŞHİS FAZI TAMAM.** Sonraki faz: düzeltme planı (§10 özet tablosu + §9
öncelik tablosu runbook M0 önerisiyle birlikte girdi). Teşhis dışı hiçbir düzeltme
yapılmadı; tek istisnalar: exam script syntax hatası (tek `)`, koşmayı engelliyordu)
ve momo_nots/runbook not güncellemeleri.

---

## 11. Teşhis Turu 3 — kanıt toplama sonuçları (2026-10-08 akşamı, delege raporları)

Yöntem: üç alt ajan paralelde koşturuldu; sonuçlar **diske** yazdırıldı (§9.1 workaround'u).
Üç görevin üçü de işini bitirdiği halde 30 dk "inactivity" ile **timeout sayıldı** — §9.1'in
üçüncü ve en güçlü kanıtı: alt ajan araç çağırıp dosya üretmesine rağmen "hareketsiz"
etiketiyle iptal ediliyor (watchdog aktiviteyi görmüyor). Raporlar diske yazıldığı için
üretim kaybolmadı: `/tmp/opencode/m0-{triage,v2-events,models}.md`.

### 11.1 V2 `session.idle` teşhisi — karar: ÇOĞUNLUKLA YOK gibi, kesin deney tanımlı
- SSE kanıtı (attempt 4 `events-seen.json`): alt ajan yaşam döngüsünde `session.idle`
  **hiç yayınlanmadı**; buna karşılık `session.execution.started/succeeded` ve
  `session.step.ended` yayınlandı. Köprü `case "session.idle"` birebir eşliyor → üretici
  yoksa V1 işleyicisi hiç tetiklenmiyor (`v2/event-hook-bridge.ts:85-86`).
- Binary'de `session.idle` literal'i VAR (`strings ~/.opencode/bin/opencode`) — kod yolu
  duruyor ama **yayınlanmıyor** olabilir (alt oturum mu / ana oturum mu ayrımı açık soru).
- **KESİN DENEY (tanımlı, yapılmadı):** izole XDG sandbox + `opencode serve` → SSE'de
  `/api/event/stream` aboneliği → bir child task tetikle → **ana oturum ve çocuk oturum**
  akışlarını karşılaştır: hangisi `session.idle` yayıyor?
- Etkilenen momo kod noktaları (rapor listesinden): `features/background-agent/
  session-idle-event-handler.ts` (birincil bitiş tespiti), `parent-wake-flush-runner.ts`,
  `parent-wake-notifier.ts`, `manager.ts`, `features/monitor/output-injector.ts`,
  `hooks/team-session-events/*`, `hooks/shared/session-idle-settle.ts` (kaynak),
  `cli/run/event-session-handlers.ts` + 15+ test mock'u.

### 11.2 Test triajı (delege raporu — benim prompt değişikliklerimden ÖNCE ölçüldü)
- Ölçülen bar: **39 fail**. Büyük çoğunluk `dev..HEAD` diff'iyle temas etmeyen
  **PRE_EXISTING** (`shared-skills` manifest 3, `createBuiltinAgents` 2, sisyphus factory 5,
  CLI installer 3, catalog MCP 8, prompt reconciler 3, current-model-family, dist bundle,
  markdown link).
- **Tek net REGRESSION (bu dalın ürettiği):** `M2b QA manifest drift guard` — bu dalda eklenen
  yeni testin karşılaştırdığı `script/qa/opencode-v2-qa-tool-surface.json`_committed_ hali,
  `buildQaManifest()` çıktısından eski (stale commit).

### 11.3 Beleş model profili (opencode provider) — görev dağıtımı için
Kaynak: `/tmp/opencode/m0-models.md` (URL'li). Özet:
- Uzun bağlam (served 1.0M): nemotron-3-ultra-free, muse-spark-1.3-contributor-free,
  longcat-2.5-preview-free, space-bunny/exo/fledge (anonim, dikkat).
- Hızlı mekanik işler: nemotron-3.5-lightning-free (262K), big-pickle (her zaman ücretsiz
  son çare), mimo-v2.6-flash-free (tool döngüsü şikayeti var, gözetimli).
- Orta/ağır kod işi: muse-spark-1.3-contributor-free (Meta, agentic coding), ling-3.1-flash-free
  (560B), nemotron-3-ultra-free (550B).
- **GİZLİLİK (kullanıcı bilmeli):** çoğu beleş modelde veri **eğitimde kullanılabilir**
  (big-pickle, exo/fledge, mimo, ling, muse-spark contributor, nemotron trial). Zero-retention
  olanlar yalnızca: **step-5-preview-free, longcat-2.5-preview-free, space-bunny-free**.
  Müşteri/özel kod işlerinde zero-retention olanlar tercih edilmeli.
- **"Step 5 Preview Free" VAR AMA YERELDE YOK:** StepFun amiral gemisi (~600B MoE, 1M,
  zero-retention) Zen dokümanında listeli, yerel `opencode models` çıktısında hiç `step*`
  yok. Sebep muhtemelen model listesi bayat / auth yenilemesi gerek (`/connect` veya provider
  cache refresh). Ayrı bir küçük iş: provider listesini tazele.

### 11.4 Yapılan düzeltme (bu oturum, kullanıcı talebi: "tek sade prompt, model varyantı yok")
- `sisyphus-agent-factory.ts`: model ailesine göre 13 varyant seçen switch **kaldırıldı** →
  tüm aileler tek `buildMomoOrchestratorPrompt()` gövdesini kullanıyor (Gemini overlay ve
  family≠fallback ek bölüm enjeksiyonu da kalktı). `resolveSisyphusPromptFamily` reconciler
  için korundu.
- `momo-core-sections.ts`: 3.928 → ~1.7 KB. Üç kez tekrarlanan terslik/tone/constraint
  blokları tek `<momo_core_behavior>` gövdesine indi; `catalog_pick` MANDATORY → koşullu
  ilke (araç yüzeyde yoksa doğrulanabilir seçim + gerekçe); `lsp_diagnostics` referansı →
  projenin kendi kapıları; hardcoded eski model adları (gpt-5-nano, claude-haiku-4-5,
  glm-5.3-flash) çıkarıldı.
- `momo-orchestrator.ts`: ~9.75 → ~8.8 KB. Model-koşullu iki bölüm (`buildNonClaudePlannerSection`,
  `buildParallelDelegationSection`) çıkarıldı → gövde artık **modelden bağımsız, birebir aynı**
  (GLM vs Claude karşılaştırması: `diffAt` = son). Verification ile Phase 3 tekrarı birleştirildi.
- Testler YENİ sözleşmeye güncellendi (silinmedi): 5 sisyphus factory testi artık
  "tek uniform gövde" iddiasını doğruluyor; bir tanesine V2 regresyon koruması eklendi
  (prompt `todowrite` içeremez — V2'de araç yok).
- Doğrulama: `bun run typecheck` temiz; `src/agents/` taraması yalnızca bilinen 2
  `createBuiltinAgents` hatasıyla geçiyor. **ÇALIŞAN OTELEME: varyant dosyaları (kimi-*,
  claude-*, gpt-5-*, grok-4, glm-5-2, default) artık fabrikada kullanılmıyor ama diskte
  duruyor** — kullanıcı gözden geçirdikten sonra silinecek (baştan-yazım planı §M0 Faz 3).

---

## 12. OTURUM DURUMU — 2026-10-08 kapanış (kullanıcı "reset atıyorum, sonra devam")

Burası devam noktasıdır. Önceki bölümler teşhis (§9-§11), plan `notes/m0-fix-plan.md`.

### 12.1 Bu oturumda YAPILANLAR (kod + not)
1. **Tek prompt gövdesi (Faz 3 başı).** `sisyphus-agent-factory.ts`: 13 varyantlık switch
   kaldırıldı → tüm model aileleri tek `buildMomoOrchestratorPrompt()` gövdesini alıyor.
   `momo-core-sections.ts` 3.9→1.7 KB (tekrar eden terslik/tone/constraint blokları tek
   `<momo_core_behavior>` gövdesine indi). `momo-orchestrator.ts` 9.8→~8.7 KB; Claude/
   non-Claude koşullu iki bölüm çıkarıldı → **gövde modelden bağımsız** (GLM vs Claude-Sonnet
   bayt bayt aynı, `diffAt` = son). Ölü referanslar temizlendi: `lsp_diagnostics`, hardcoded
   eski model adları, `catalog_pick` MANDATORY zorunluluğu (araç yokken uygulanamıyordu).
2. Testler yeni sözleşmeye **güncellendi** (silinmedi): 5 sisyphus factory testi artık tek
   uniform gövdeyi doğruluyor; birine V2 regresyon koruması (`prompt` `todowrite` içeremez).
3. `bun run typecheck` TEMİZ. `dist` yeniden kuruldu (root `dist/index.js`, 6.8 MB).
4. Notlar: §9 (V2 kırık sistemler), §10 (teşhis turu 2), §11 (delege raporları), §7 plan.

### 12.2 GÜNCEL TEST BARı ve doğru koşum şekli
- `cd packages/omo-opencode && bun test` → **42 fail** (kişi sayımı değişken; bir kısmı
  koşum dizinine/order'a bağlıdır).
- **ÖNEMLİ ÖLÇÜM KURALI:** `dist-bundle-prompt-content` testi `dist/index.js` yolunu CWD'ye
  göre arar — **repo root'undan koşunca GEÇİYOR** (`bun test packages/omo-opencode/src/...`),
  alt paketten koşunca "must exist" diye düşüyor. Yanlış sınıflandırmayın (delege triaj
  raporundaki #26 da bu yüzden yanlış işaretlenmiş).

### 12.3 Reset sonrası YENİ BULGU — §10.2 REVİZE
- **Catalog MCP sunucu resetinden sonra GERİ GELDİ:** `catalog_list` canlı çalışıyor, 11
  opencode modelini context_window/pricing/strengths ile listeliyor. Yani "catalog MCP yok"
  bulgusu kalıcı değil — **araç yüzeyi sunucu durumuna göre düşüp geliyor** (oturum içi
  MCP registration kararsızlığı). `lsp` araçları da resetle geri döndü.
- Model listesinde **Step 5 Preview Free hâlâ yok** (Zen dokümanında var) → provider listesi
  tazeleme/auth yenileme işi duruyor.
- Katalog metadata'sı: beleş modeller `tool_call: false` işaretli — ajan döngüsünde dikkat.

### 12.4 AÇIK İŞLER (devam sırası önerisi)
| # | İş | Durum |
|---|---|---|
| 1 | Eski varyant dosyalarını sil (kimi-*, claude-*, gpt-5-*, grok-4, glm-5-2, default) — fabrikada kullanılmıyor | **kullanıcı gözden geçirecek** |
| 2 | `sisyphus-runtime-prompt-reconciler` artık ANLAMSIZ (tek gövde olduğu için aile uyuşmazlığı imkansız) + 3 testi eski mimariyi doğruluyor → reconciler emekli edilmeli, testler güncellenmeli | yeni öneri |
| 3 | Faz 1: V2 `session.idle` kesin deneyi (§11.1'de tanımlı) sonra bildirim zinciri baştan yazım | planlı |
| 4 | Catalog/lsp MCP'nin NEDEN düştüğü (resetle geliyor) — registration kararsızlığı | §10.2 revize |
| 5 | Provider listesi tazeleme (Step 5 Preview Free gelsin) | küçük |
| 6 | M2b QA manifest drift (tek gerçek regresyon) | Faz 0 |
| 7 | Todo kararı (A: `/session/{id}/todo` / B: emekli) | kullanıcı onayı |
| 8 | Test barı triajını DOĞRU CWD ile tekrarla | Faz 0 |

### 12.5 Çalışma düzeni notu (§9.1 için kalıcı workaround)
Bg görevlerin sonucu dönmediği için: **her delege görevi sonucunu dosyaya yazsın**, biz
diskten okuruz. Kanıt: üç görev işini bitirdiği halde 30 dk "inactivity" ile iptal sayıldı,
üretim dosyalarda kurtuldu (`/tmp/opencode/m0-*.md`).
