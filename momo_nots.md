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
