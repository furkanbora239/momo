# Native v2 ilk gerçek model testi: Anchor saha incelemesi

Tarih: 2026-10-13, Europe/Istanbul. Durum: araştırma raporu; düzeltme uygulanmadı.

## Kapsam ve kanıt

Anchor kök oturumu: `ses_ecb63fb28ffehQ3JV7hTqBX4Nh`, başlık: `Push, stuck button, planner ve buglar`. Çalışma dizini: `/home/furkanbora/code/flutter apps/Anchor`. Oturum kaydındaki OpenCode sürümü `2.0.27`; önceki kabul çalışmaları `2.0.24` üzerinde yapılmıştı. momo checkout: `dev`, `94717a3ffe5f77b06cce1cad0a55a9c2d31132f2`. Yerel git geçmişi #34 native aktivasyon ve #35 orkestratör prompt değişikliğini içeriyor. Yapılandırma yerel `momo/dist` yüklemesini gösteriyor; inceleme anındaki bundle SHA256: `53633daf4fca479bd197fc5d4f28f5de1209ce6e5f5dfcaa3684d96a0a594d49`. Bu hash çalışan süreç belleğinin hash'i olarak yorumlanmamalı.

İnceleme, `opencode-qa` yönteminin canlı DB için salt okunur yolunu kullandı. Üç alt ajan teslim/soru, API ve yönlendirme/katalog alanlarını ayrı inceledi. OpenCode başlatılmadı; canlı oturum, görev deposu, kullanıcı yapılandırması veya Anchor dosyaları değiştirilmedi. Bu rapor ve momo içindeki kanıt dosyaları oluşturuldu.

Birincil kaynaklar:

- Ajanın kendi raporu: `/home/furkanbora/code/flutter apps/Anchor/docs/agent_orchestrasyon_notlari.md`.
- SQLite: `/home/furkanbora/.local/share/opencode/opencode.db`, `mode=ro`; aktif v2 tabloları `session_v2`, `session_message`, `session_inbox`.
- Görevler ve yönlendirme kayıtları: `/home/furkanbora/.omo/native/projects/e07f80037f98633435544300/{tasks.json,routing-ledger.jsonl}`.
- momo native kaynak kodu, sahip olunan rol promptları ve önceki kabul sürücüleri.
- Yerel kanıt paketi: `.omo/evidence/20261013-first-live-test/`. Ham oturum/kimlik bilgileri kopyalanmadı. `sanitized-snapshot.json` görev, model, durum, boyut ve kuyruk metadatasını içerir.
- Ayrıntılı alt incelemeler: aynı pakette `api-audit.md`, `routing-audit.md`, `delivery-audit.md`; kaynak kimlikleri `source-identities.json`, kurulu OpenCode kuyruk sözleşmesi `installed-opencode-queue-excerpts.txt`. `.omo/evidence` git tarafından ignore edilir. Başka bilgisayarda sürdürülebilmesi için üç inceleme, kaynak kimlikleri ve sanitize snapshot ayrıca `notes/native-v2-first-live-test-20261013/` altında git'e eklenebilir arşiv olarak saklandı. Bu çalışma commit/push yapmadı.

Canlı kayıtlar değişebilir. İlk okumada 63 görev vardı; **13:27:28** snapshot'ında 64 görev vardı. Son eklenen görev rapora ek yazdırma girişimiydi ve `interrupted` durumundaydı. Bu fark araştırma sırasında bizim görev başlatmamızdan kaynaklanmıyor.

## Ölçülen durum

| Ölçüm | Sonuç | Yorum |
|---|---:|---|
| Kalıcı görev | 64 | 53 iç katalog araştırması, 11 diğer görev |
| Seçim bekleyen | 52 | 51 araştırma, 1 kaybolan normal görev |
| Diğer durumlar | 5 succeeded, 2 failed, 4 cancelled, 1 interrupted | Modelin bitmesi ürün işinin doğrulandığı anlamına gelmez |
| Katalog araştırması | 53 | 48 düşük güven, 3 yanlış malformed sınıflaması, 2 gizlilik reddi |
| Kök yönlendirme seçenekleri | 424 | 53 model × 8 rol; Jev sınırı 255 |
| Departman seçenekleri | 265 | 53 model × 5 rol; sınırın üstünde, bu örnekte çağrı breaker tarafından atlandı |
| Normal görev araç yanıtı | Yaklaşık 460–487 KB | JS `JSON.stringify(task, null, 2)` UTF-8 ölçümü; token sayısı değildir |
| Aday dizisi tek başına | Yaklaşık 425 KB | Normal yanıtların yaklaşık %87–92'si |
| İşlenmiş olay geçmişi | En fazla 128 kimlik | Rapordaki “binlerce processedEventIDs” iddiası doğru değil |
| Kök bekleyen mesaj kuyruğu | 8 | Hepsi synthetic / queue; eski soru bildirimi de mevcut |
| Araştırma Jev kullanımı | 53 çağrı, 1.347.578 input token | Kayıtlı sağlayıcı kullanım verisi |
| Araştırma Jev maliyeti | $0,056598276 | Yanıtta bildirilen maliyet; fatura doğrulaması değil |
| Yönlendirme günlüğü | 102.544.158 byte, 271 satır | Yaklaşık 97,8 MiB; büyüme ve yeniden yükleme maliyeti |

## Doğrulanan bulgular ve düzeltme sırası

### F01. Jev seçenek sınırı canlı katalogda aşılmış [kritik, ajan fark etmedi]

İlk normal görev `ntask_db74f6bf-4886-4cb6-941a-81d65a60e8fa` için HTTP 400 yanıtı: `Too many choices. Must have at most 255 choices.` Native yol rol/model çarpımını tek choice sorusunda gönderiyor: 424 seçenek. Bu yüzden elle seçim zorunluluğunun ana nedeni normal düşük güven davranışı değil, gerçek API sözleşmesi ihlali. Sonraki bazı kararlar circuit breaker nedeniyle Jev'e bile gitmiyor.

Kanıt: ledger satır 56 ve 222; diğer büyük istekler 225, 228, 247, 266. Kaynak: `packages/omo-opencode/src/native-routing/router.ts:110-120`, `role-policy.ts:3-4`, `jev-adapter.ts:6-26`. Departmanların 265 seçeneği de yapısal olarak aynı sınırı aşar; bunların gerçek HTTP reddi bu oturumda gözlenmedi.

Düzeltme yönü: rol/lane ve model seçimini sınırı gözeten bir sözleşmeyle tasarlamak. Uygun model havuzunu keyfi daraltmak veya sessiz fallback eklemek native tasarımın gereklerini bozar. Kabul kanıtı: 53 ve daha fazla modelle gerçek sözleşme uyumlu otomatik worker/departman yönlendirmesi.

### F02. İlk görev 53 otomatik araştırma işi oluşturmuş [yüksek, ajan fark etmedi]

53 araştırmanın tamamı ilk görevin `sourceDecisionID` değerine bağlı; görev oluşturma zamanları 19 ms aralığında. Eksik bilgi için her modele bir native görev açılıyor ve her araştırma tekrar Jev yönlendirmesine gidiyor. **51 araştırma hiçbir worker oturumu açmadan seçim bekliyor.** Bu sayı 51 çalışan LLM ajanı anlamına gelmez; buna rağmen 53 Jev isteği yapılmış.

Kanıt: `router.ts:114-134`, `native-runtime/task-tools.ts:105-112`, `native-task/engine.ts:60-118`. Araştırma tekilleştirmesi süreç ömrüne bağlı (`router.ts:36,125-128`); restart sonrası tekrar iş oluşturulabilmesi kaynak koddan çıkarım, bu oturumda restart ile doğrulanmadı. Araştırma ve normal işler ortak seri Jev kuyruğunu kullanıyor; sonraki işi geciktirme riski var, bu oturum için ölçülmüş gecikme nedeni olarak sunulmuyor.

Düzeltme yönü: sınırlandırılmış, kalıcı ve kullanıcıdan tek tek model seçimi beklemeyen araştırma akışı; normal görev görünürlüğünden ayrılmış bakım işleri. Kabul kanıtı: eksik bilgili büyük katalogda ilk kullanıcı görevi araştırma fırtınası veya seçim bekleyen bakım yığını üretmez.

### F03. Teslim kabulü ile mesaj tüketimi ayrılmamış [kritik, ajan yalnız belirtiyi gördü]

Ekrandaki sabit `Native task ... result/question` satırları toast değil, native bekleyen mesajlar. Sekiz kuyruk girdisi DB'de dururken ilgili görevler momo tarafında `delivery.status=delivered`. Teslim fonksiyonu SDK çağrısının kabulünü teslim tamamlandı sayıyor. Bunun tüketilme/ana konuşmaya işlenme garantisi olmadığı canlı kayıtta görülüyor. Kök konuşmada materialize olmuş iki synthetic sonuç katalog gizlilik hataları; normal sonuçların kuyrukta kalmasıyla birlikte gecikmiş, yanıltıcı hata bildirimi oluşuyor.

Kanıt: `session_inbox`, `session_message`; `native-runtime/session-runtime.ts:136-151`, `native-task/task-controls.ts:142-168`. Ekran görüntüsü alınmadı; TUI belirtisi kullanıcının gözlemi, DB karşılığı doğrulandı. OpenCode tüketim dalının ayrıntıları destekleyici teslim incelemesindedir. Tam üretim düzeltmesinin momo mu OpenCode mu tarafında yapılacağı ayrı izole deneyle kesinleştirilmeli.

Düzeltme yönü: admission, consumption ve kullanıcı/model görünürlüğünü ayırmak; busy parent, code-mode ve idle geçişlerini birlikte sınamak. Eski kuyruk satırlarını silmek kök nedeni düzeltmez. Kabul kanıtı: aynı ID ile tek teslim, gerçek konuşmada sonuç, sonuç işlendiğinde boş kuyruk.

### F04. Araç API'si iç görev kaydını bütünüyle döndürüyor [yüksek, ajan fark etti]

`response()` pretty JSON metni üretiyor; `status`/`wait` ham `NativeTask` döndürüyor. Manuel seçim sonrasında eski `candidates` temizlenmiyor, dolayısıyla tamamlanmış görev sorgusu bile yüzlerce KB taşıyor. Büyük bölüm aday katalog tekrarı; olay kimlikleri ana neden değil.

Kanıt: `native-runtime/task-tools.ts:43-45,190-202`, `native-task/task-controls.ts:234-261`, `native-task/guards.ts:4-39`. Boyutlar destekleyici API incelemesinde JS serileştirmesiyle ölçüldü.

Ham byte boyutu modelin gördüğü token sayısı değildir. Gerçek tool display bir örnekte 17.112 satırı yaklaşık 51 KB'a kesmiş; code-mode ajanı başka örneklerde kendisi slice/filtre uygulamış. Büyük sözleşmenin kendisi ve onu elde işleme zorunluluğu kanıtlı; toplam token yakımının tamamını bu byte'lara bağlamak doğru değil. Ayrıca seçilmiş görevde eski routing `error` alanı da kalabilir; başarı/durum yorumunu daha da karıştırır.

Düzeltme yönü: iç kalıcı kayıt ile modelin gördüğü yanıtı ayırmak; kompakt durum, gerektiğinde sayfalı aday/ayrıntı ve sınırlandırılmış sonuç erişimi. Kabul kanıtı: 424 adaylı görevde status/select/cancel cevaplarının boyutu aday katalogla orantılı büyümez; ID ve karar bağı korunur.

### F05. Dönüş sözleşmesi ve kayıp ID kurtarma eksik [yüksek, ajan fark etti]

Code-mode'da `tools.momo_task` bir JSON metni döndürüyor. Ajan nesne bekleyip `.id` okuyunca kaybetmiş. Bu keyfi aralıklı dönüş tipi değişimi kanıtı değil; belgelenmeyen metin sözleşmesi. `list` action'ı yok; mevcut RPC görev listesi ajan tool yüzeyinde yok.

Gerçek yetim görev: `ntask_c1fc8e20-fe7e-450e-bf85-cfedab0d3424`, `awaiting_selection`, attempts 0, model/rol/session yok. Gizlilik hatası veren worker'a otomatik dönüşmemiş, dosyalarda işlem yapmamış. Kayıp ID gerçek, rapordaki sonraki çalıştırılma öyküsü yanlış.

Kanıt: task store; `task-tools.ts:30-45,211-224`. Düzeltme yönü: OpenCode araç sözleşmesiyle uyumlu açık dönüş şeması/örnekleri ve root/parent yetkilendirmeli kompakt liste/kurtarma. “Her zaman nesne döndür” önerisi native tool protokolü kontrol edilmeden uygulanmamalı.

### F06. Rol yetkileri caller seçiminde anlaşılır değil [yüksek, ajan fark etti ama nedeni yanlış koydu]

`executor` uygulama koordinatörü: shell/edit kullanamaz, worker'lara görev verir. İlk executor'ın alt görev açması izinli davranış. İkinci denemede executor seçilip delegasyon da yasaklanınca araçları olmayan ajan çıkmaza girmiş. Gerçek worker'ın delegasyon yasağı zaten var. Model tool-call yeteneği ile role verilmiş shell/edit izni ayrı kavramlar.

Kanıt: `assets/native-agents/momo-executor.md:2,7`; `native-runtime/role-policy.ts:94-103`; `native-routing/role-policy.ts:33-34`. İlgili görevler: `ntask_1f0c7229...`, `ntask_e89c6274...`; gerçek worker `ntask_931f732b...` shell/read araçlarını kullanmış, kullanıcı durdurunca iptal edilmiş.

Düzeltme yönü: caller'a rol açıklaması ve mevcut runtime izinleri sunmak; direct-edit isteği için worker/departman ayrımını belirginleştirmek. Kabul kanıtı: gerçek akıl yürüten model uygun rolü seçer ve yanlış rolü prompt ile aşmaya çalışmaz.

### F07. Soru yanıtı yarışında durum ve bildirimler yanıltıcı [yüksek, ajan fark etti; timeout açıklaması yanlış]

İstanbul zamanıyla soru aracı 13:06:18.948'de açılmış, bildirim 13:06:19.062'de kuyruğa girmiş. Native soru 13:07:10.145'te `Çıktı dosyasına izin ver` yanıtıyla tamamlanmış. Kök ajan 13:07:26.338'de cevap vermeye çalışınca `Task is not waiting for that question` almış. Cevap yaklaşık 51 saniyede gelmiş; 120 saniyelik deadline dolmamış. Executor 13:07:57.462'de tamamlanmış. Soru bildirimi cevaplandıktan sonra bile kök inbox'ında kalmış.

Kanıt: child/root `session_message`, task `ntask_1f0c7229...`, soru `frm_134ba2d510019i1ejDGwIqQIwG`. Cevabın hangi UI/client üzerinden verildiği mevcut DB kayıtlarıyla kesinleşmiyor. Native tool kaydı cevap olduğunu kanıtlıyor; cevapsız başarılı tamamlanma bu örnekte kanıtlanmıyor.

Ek ergonomi: bildirime gerçek form sorusu yerine `Questions` başlığı yazılmış; açıklayıcı `q0` alanı/description kayıtta var ama notification metnine taşınmıyor (`session-runtime.ts:166-171`). Düzeltme yönü: soru alanını anlamlı aktarmak, çözülmüş soruyu güncel göstermek, geç cevabı idempotent biçimde açıklamak ve native/forwarded cevap yollarını birlikte sınamak.

### F08. Provider gizlilik politikası uygun model bilgisine yansımıyor [yüksek, ajan belirtisini gördü]

Gizlilik reddi alan iki model `muse-spark-1.2-contributor` ve `muse-spark-1.3-contributor`; ikisi de katalog araştırması. İlgili görevler `ntask_4b48d49d...` ve `ntask_a7b8e595...`. Provider listesinde bulunmak/model endpoint'inde görünmek bu workspace'te çalıştırılabilir olmakla eş tutulmuş.

Kanıt: ilgili assistant provider errors; ledger 220–221; `native-catalog/adapter.ts:36-77`, `native-routing/router.ts:92-108`. Düzeltme yönü: erişilebilen policy/health bilgisini uygunluğa taşımak ve görev+rol+model içeren hata sunmak. Kullanıcının gizlilik ayarını gevşetmek veya sessiz modele geçmek önerilmiyor.

### F09. Olasılık doğrulamasında kayan nokta sınır hatası [orta, ajan fark etmedi]

Üç gerçek Jev cevabının toplamı 0.99. `Math.abs(0.99 - 1)` sonucu `0.010000000000000009`, dolayısıyla `> 0.01` kontrolü bunları malformed sayıyor. Bunlar düzeltilse de düşük güvenleri nedeniyle araştırmanın otomatik başlaması garanti değil.

Kanıt: ledger 143, 151, 189; `native-routing/jev-answer-validation.ts:16`; yerel Bun hesabı aynı sonucu verdi. Düzeltme yönü: açık sayısal tolerans ve gerçek yuvarlanmış vektörlerle davranış testi.

### F10. Malformed sayılan ücretli cevaplar bütçeye yazılmıyor [orta, ajan fark etmedi]

Usage, cevap doğrulandıktan sonra toplanıyor. 50 kabul edilen araştırma cevabı $0,053394936; reddedilen üç cevabın kayıtlı ek maliyeti $0,00320334. Yeniden yüklemede de sadece `jevAnswer` dikkate alındığı için eksik hesap kalıcı.

Kanıt: `router.ts:73-77,245-248`. Düzeltme yönü: faturalanabilir transport kullanımını kararın geçerliliğinden ayrı kaydetmek; geçersiz/az güvenli cevabı bütçede saymak. Kabul kanıtı: başarısız yorumlanan ama usage dönen yanıt da aylık limite dahil.

### F11. Ledger tekrarları disk ve yükleme maliyetini büyütüyor [orta, ajan fark etmedi]

102,5 MB/271 satır. Değişen kararın tam hali tekrar ekleniyor; aday snapshot'ları ve HTTP request body birden çok kez tutuluyor. Başlangıçta tüm dosya ve versiyonlar okunuyor. Bu, tool yanıtı şişmesinden ayrı bir sorun. Auth header redaction ve kısıtlı dosya izinleri mevcut; burada credential sızıntısı kanıtlanmadı.

Kanıt: `router.ts:61-64,152-177`; `jev-adapter.ts:108-142`; `jsonl-store.ts:21-39,59-67`. Düzeltme yönü: audit doğruluğunu koruyan delta/tekilleştirilmiş snapshot ve sınırlı yükleme/index. Kabul kanıtı: büyük katalogla tekrarlı durum geçişinde kayıt boyutu ve restart belleği ölçülür.

### F12. Başarılı execution ile yapılmış iş ayrımı görünür değil [yüksek, ajan fark etti]

Executor hiçbir kod değiştirmediğini söyleyerek `succeeded` olabiliyor. Native state modelin hatasız bitmesini anlatıyor; acceptance doğrulandığını anlatmıyor. Bu durumda “iş başarılı” olarak okunması yanıltıcı. `progress` üretim metni sonuçta kalabiliyor; mevcut activeTools iç kayıtta olsa da kompakt ve anlamlı iş ilerlemesi yok.

Kanıt: `native-task/events.ts:35-43,61-66`; `session-runtime.ts:105-128`; executor sonuçları. Düzeltme yönü: execution outcome, blocked/no-work ve doğrulama durumunu ayrı göstermek. Kanıt olmadan otomatik acceptance success üretilmemeli.

### F13. Scope bir koordinasyon garantisi değil [geliştirme ihtiyacı, ajan fark etti]

Scope metni yönlendirmeye taşınıyor; dosya kilidi/çakışma önleme sözleşmesi yok. Aynı dosyaya paralel yazma bu oturumda yaşanmış bir veri bozulması olarak kanıtlanmadı. Ajanın çakışmayı elle önleme ihtiyacı geçerli bir ürün gereksinimi. Ayrı tasarım yapılmalı; mevcut serbest scope metninden kesin dosya sahipliği türetilmemeli.

### F14. Repo briefing tekrarları için ölçüm eksik [geliştirme ihtiyacı, ajan fark etti]

Her alt ajana AGENTS.md okuma talimatı yeniden yazılmış. Child session doğru proje dizinini miras alıyor (`session-runtime.ts:84-89`), fakat otomatik talimat yüklenmesi ve gerçek prompt içeriği bu incelemede eksiksiz yakalanmadı. “Proje kuralları hiç yüklenmiyor” iddiası doğrulanmadı. Önce native instruction davranışı ölçülmeli, sonra tekrarları azaltacak çözüm tasarlanmalı.

### F15. İki child iptali aynı departmanda üç rapor turu üretmiş [orta, ajan fark etmedi]

Executor oturumunda cancellation A sonucu `seq102`, toplu children wake `seq131`, cancellation C sonucu `seq148` ayrı üretimlere yol açmış; aynı iptal durumu üç kez raporlanmış. Kullanıcı işinde ilerleme yok. Bireysel sonuçlar ile aggregate wake birlikte gereksiz generation üretme riski taşıyor.

Kanıt: `delivery-audit.md:D5`, mesajlar `msg_fcd39006bf000eac4d09f8967d`, `msg_071feb72cb62c69d9efa71a8ce`, `msg_ad46b80506c12308f9e9eb080b`; `session-runtime.ts:197-200`. Bu oturumda tekrar üretim doğrulandı; hangi batching değişikliğinin güvenli olduğu izole eşzamanlı completion/cancel deneyiyle belirlenmeli. Normal sonuçları kaçırmadan departman wake sayısını sınamak F03/F07 ile aynı teslim adımına dahil.

### F16. İzinli read/grep, kesilmiş çıktı dosyasını ikincil izin kontrolünde okuyamıyor [yüksek, ajan kök nedeni fark etmedi]

Executor kendi tool sonucunun OpenCode `tool-output` dosyasını okumaya çalışmış; native FileAccess repo dışı erişim için `external_directory` izni istemiş. momo permission hook bu ikincil erişim iznini de tool-action allowlist'ine sokuyor. Coordinator için `external_directory` tanınmış readonly tool değil, dolayısıyla kesin deny. Native read/grep repo içinde çalışırken aynı izinli araçlarla kesilmiş sonucu okuyamıyor.

Kanıt: `native-runtime/permission-policy.ts:5-11`, `role-policy.ts:91-100`; child transcriptindeki tekrar eden external_directory reddi; kurulu OpenCode gömülü FileAccess authorizeRead sözleşmesi. Canlı read/grep reddi ve kaynakta deterministik deny doğrulandı; o anki evaluate-hook trace'i tutulmadığından her bir çağrının hook olayını ayrıca göstermek mümkün değil. “Çıktı dosyasına izin ver” cevabı ordinary `question` cevabıydı, gerçek permission grant değildi; cevap sonrasında read yine reddedildi. Bu, F04'ün büyük yanıtıyla birleşip sonucu takip etmeyi daha da zorlaştırıyor.

Düzeltme yönü: tool eylemi ile resource permission kararını ayırmak; güvenilir native çıktı store'u için salt okunur ve kapsamı doğrulanmış erişim. Unknown custom/MCP action koruması kaldırılmamalı; tüm dış dizinlere genel izin verilmemeli. Kabul kanıtı: coordinator kesilmiş kendi task çıktısını okuyabilir, aynı anda dış dosya yazma/shell ve bilinmeyen tool sınırları korunur. Ayrıntılar `delivery-audit.md` ek bölümünde.

## Ajanın S1–S13 iddialarının kararı

| İddia | Karar | Düzeltme/ayrım |
|---|---|---|
| S1 JSON string / ID kaybı | Doğrulandı | Sabit metin dönüş sözleşmesi; rastgele tip değişimi değil |
| S2 kurtarma/list yok | Doğrulandı | Yetim görev seçim bekliyor, hiç dispatch olmadı |
| S3 create sonrası select | Belirti doğru | Bu katalogda asıl neden 424-choice reddi; her create için evrensel şart değil |
| S4 dev status/wait | Doğrulandı | 8 rol × 53 model; olay kimlikleri en fazla 128 |
| S5 wait sonuç yok / invalid JSON | Desteklenmedi / yanlış teşhis | wait tam task döndürüyor; hata `JSON.parse(o.question)` ile nesneyi yeniden parse etmekten |
| S6 worker delegasyon yaptı | Yanlış rol tanımı | Ajan executor idi; delegasyon izinli ve beklenen |
| S7 cevapsız timeout success | Bu örnekte çürütüldü | Native cevap deadline'dan önce geldi; geç root cevap ve eski bildirim sorunu gerçek |
| S8 gizlilik hatası | Hata doğru, ilişkilendirme yanlış | İki araştırmacı başarısız; kayıp bug-fix çalışmadı |
| S9 rol→yetenek görünürlüğü | Doğrulandı | Runtime izinleri model kapasitesinden ayrı gösterilmeli |
| S10 büyük ama rol bilgisi yetersiz adaylar | Doğrulandı | Aday metadatası izin/delegasyon sözleşmesi sunmuyor |
| S11 işe yaramayan progress | Doğrulandı | Execution success ve acceptance ayrımı da gerekiyor |
| S12 scope çakışma uyarısı yok | Gereksinim geçerli | Canlı write çatışması/bozulması kanıtlanmadı |
| S13 briefing tekrarları | Gözlem geçerli | Native instruction yüklenmiyor sonucu henüz çıkarılamaz |

## Önceki QA neden bunları yakalamadı?

Önceki çalışmalar gerçek OpenCode sürecini çalıştırdı; provider ve Jev cevapları kontrollü mock idi. Bu kanıtlar rol sınırları, restart, cancellation, form/result retry gibi harness sözleşmeleri açısından değerlidir. Gerçek catalog ölçeği ve gerçek modelin API'yi anlama başarısı açısından yeterli değildir.

`script/qa/momo-native-acceptance.ts:361` havuzu tek `momo-qa-model` ile sınırlıyor. Jev mock'u `:301-306` ve yanıt üreticisi `:66-95` gerçek 255-choice limitini, yuvarlanmış probability vektörlerini veya provider workspace privacy reddini temsil etmiyor. Mock modele verilmiş kod doğru JSON.parse ve seçim kullanımını zaten biliyor (`:270`); gerçek ajanın bu sözleşmeyi keşfetme zorluğu sınanmıyor. Teslim denemelerinde context'te tek mesaj görmek kuyruk boşluğu/TUI temizliği garantisi değil. Canlı sürüm de kabul sürümünden farklı; bu fark kök neden olarak kanıtlanmış değil, regression matrisine eklenmesi gereken değişken.

## Adım adım sonraki çalışma önerisi

1. **Yönlendirme sözleşmesi:** F01; büyük katalog ile API limitini aşmadan worker ve department seçimi. Sessiz fallback yok.
2. **Araştırma yükü:** F02, F08; sınırlı bakım kuyruğu, headless seçim ve policy-aware uygunluk. Normal kullanıcı işini bekleten araştırma yığını yok.
3. **Araç ergonomisi ve çıktı erişimi:** F04–F06, F16; kompakt ve açık dönüşler, list/recovery, rol izinleri, kesilmiş sonuç store'una güvenli read. Gerçek modelle kayıp ID kurtarma ve doğrudan edit rolü seçimi.
4. **Teslim ve sorular:** F03, F07, F15; admission/tüketim, busy/code-mode parent, güncel soru, geç cevap yarışları ve departman wake sayısı. Konuşma + boş kuyruk + TUI birlikte kanıtlanır.
5. **Karar doğruluğu ve maliyet:** F09–F11; tolerans, usage accounting, ledger büyümesi/restart maliyeti.
6. **İşin doğrulanması ve yeni gereksinimler:** F12–F14; blocked/no-work görünürlüğü, tool progress, dosya scope ve briefing tasarımı.

Her adım ayrı uygulanabilir değişiklik ve izole davranış kanıtı gerektirir. Bu rapor bu adımlar için başlangıç baseline'ıdır; herhangi bir bug'ın düzeltilmiş olduğu iddia edilmez. Canlı kuyruğu temizleme, görev iptali veya privacy ayarı değişikliği yapılmadı.
