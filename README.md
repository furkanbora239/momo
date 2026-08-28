# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE** — Bu depo, [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) ("oh-my-opencode" / "oh-my-openagent" upstream) projesinin token tasarrufu odaklı, baştan aşağı modifiye edilmiş bir fork'udur. Orijinal [Sustainable Use License 1.0](./LICENSE.md) (SUL-1.0, **OSI open source değildir**) lisansı altında dağıtılmaktadır. Orijinal upstream README dosyası [README.upstream.md](./README.upstream.md) olarak korunmuştur.

**momo**, OpenCode için tasarlanmış token verimliliği yüksek, **ucuz-sağlayıcı-öncelikli (cheap-provider-first)** bir yapay zeka ajan (agent) yöneticisidir. `opencode-go` + `neuralwatt` gibi uygun maliyetli sağlayıcılar için optimize edilmiştir; ancak sınırsız sayıda sağlayıcıyı destekler.

---

## 🎯 Amacı ve Felsefesi (Neden Var, Nereye Gidiyor?)

Upstream (orijinal) proje; 11 ajan, 54+ yaşam döngüsü kancası (hook), her zaman açık MCP'ler ve modele özel devasa sistem prompt'larıyla çalışır. Bu yapı, basit işler için bile pahalı modellere aşırı yüklenir ve ciddi bir token israfına (token burn) yol açar.

**momo'nun "Kuzey Yıldızı" (North Star) Felsefesi:**
> **Ucuz bir orkestratör (yönetici ajan) plan yapar, işleri agresif bir şekilde daha ucuz alt ajanlara (subagents) devreder, alt ajanların modellerini canlı bir katalogdan o anki göreve göre seçer ve mümkün olan en az çıktıyı üretir. Büyük/Pahalı modeller asla varsayılan olarak çalışmaz, sadece "istek üzerine bağlanan (bound-on-demand)" birer danışman (advisor) olarak görev yaparlar.**

- **Uygulama değil, Delegasyon:** Orkestratör bir yazılımcı değil, bir yöneticidir.
- **Yeterli olan en ucuz model:** Alt ajan modelleri, görevin türüne göre (hız, vizyon, muhakeme) canlı bir katalogdan seçilir.
- **Token Disiplini:** Minimum orkestratör çıktısı, gereksiz kancaların (hooks) kapatılması, ihtiyaç anında çağrılan MCP'ler ve varsayılan olarak kapalı telemetri.
- **Sıfır Konfigürasyon:** Sadece kur, `/models` üzerinden bir model seç ve başla. Gelişmiş kullanıcılar `~/.omo/omo.jsonc` ile her şeyi ezebilir (override).

---

## ✨ Öne Çıkan Özellikler (Neler Yapıldı?)

### 1. Local Prompt Translator (Ollama İle Ne İşi Var?)
Kullanıcının yazdığı her mesajı (Türkçe veya başka bir dil) OpenCode'a gitmeden önce araya girerek (`experimental.chat.messages.transform` kancası ile) **yerel bir Ollama modeline** (Varsayılan: `qwen2.5:1.5b`) gönderir. 
- **Ne Yapar?** Mesajı İngilizceye çevirir ve "Caveman" (Mağara adamı) tarzında sıkıştırır (Gereksiz bağlaçları, kibarlık ifadelerini atar, sadece teknik terimleri, kodları ve yolları birebir bırakır).
- **Neden?** İngilizce, LLM'ler için çok daha "token-yoğun" bir dildir (daha az token harcar). Ayrıca gereksiz kelimelerin atılması, asıl pahalı olan ana modele giden girdi (input) token'larını ciddi şekilde düşürür.
- **Ollama Entegrasyonu:** Bu eklenti, eğer sisteminizde Ollama yoksa **otomatik olarak kurar**, `qwen2.5:1.5b` modelini indirir (terminalde progress bar ile) ve arka planda çalıştırır. Tüm çeviri I/O logları, gelecekte bu işe özel daha küçük bir modelin eğitilmesi (finetuning) amacıyla `~/.omo/local-translator-logs/` altına kaydedilir.

### 2. Ponytail / Caveman Prompt Optimizasyonu
Sistem prompt'ları (her turda modele tekrar tekrar gönderilen talimatlar) baştan aşağı yeniden yazıldı.
- **Caveman (Sıkıştırma):** Promptlardaki uzun açıklamalar, gereksiz edatlar ve hikayeleştirmeler silindi. Kurallar tamamen teknik ve kısa cümleler/maddeler haline getirildi.
- **Ponytail YAGNI Merdiveni:** Modele her zaman en tembel (lazy) çözümü bulması emredildi. (Buna gerçekten gerek var mı? -> Kodda zaten var mı? -> Standart kütüphanede var mı? -> Tek satırda çözülür mü? -> En son çare kod yaz).

### 3. Model Catalog MCP (Dinamik Model Seçimi)
Bağlı olan tüm sağlayıcıları (providers) tarayan yerleşik bir MCP. Orkestratör ajan, alt ajanları görevlendirirken bu kataloga danışır ve görevin gereksinimine en uygun ve en ucuz modeli (`catalog_pick`) seçer.

### 4. Advisor (Danışman) Rolü
Büyük ve pahalı modeller (Örn: Claude Opus, GPT-4) asla varsayılan olarak kod yazmaz. Sadece tıkandığınızda veya mimari bir karar alırken `/advisor neuralwatt/glm-5.2` komutuyla o oturum için bir danışman bağlarsınız. Danışmana tüm sohbet geçmişi gitmez; sadece hedefin, denenenlerin ve hatanın özetlendiği kısa bir metin gider ve kısa direktifler vermesi beklenir.

### 5. Repo-map Auto-injector
Aider benzeri bir yaklaşımla, projenizdeki `.codegraph` indeksini okur ve dosya ağacı ile en önemli (centrality) sembollerin imzalarını sıkıştırılmış bir harita olarak oturumun ilk mesajına gizlice ekler. Ajanların projeyi keşfetmek için harcayacağı onlarca arama/grep token'ından tasarruf sağlar.

---

## 🚀 Nasıl Kurulur?

**Zorunlu Bağımlılıklar:**
- [Bun](https://bun.sh/) (Sadece `bun` desteklenir; npm, yarn, pnpm kullanılmaz).
- [OpenCode CLI](https://opencode.ai/)

**Kurulum Adımları:**

1. **Repoyu Klonlayın ve Bağımlılıkları Yükleyin:**
   ```bash
   git clone <repo-url> omo
   cd omo
   bun install
   ```

2. **Eklentiyi Derleyin (Build):**
   ```bash
   bun run build
   ```
   *(Bu işlem TypeScript kodlarını derler, JSON şemalarını oluşturur ve `./dist` klasörünü hazırlar.)*

3. **Eklentiyi OpenCode'a Kaydedin:**
   ```bash
   opencode plugin . --force
   ```
   *(Bu komut, bulunduğunuz dizindeki eklentiyi OpenCode'un `.opencode/opencode.json` yapılandırmasına ekler. Artık OpenCode'u başlattığınızda `momo` otomatik olarak yüklenecektir.)*

4. **Çalıştırın:**
   ```bash
   opencode
   ```
   OpenCode arayüzünde veya CLI'sında `/models` yazarak bir model seçin. Seçtiğiniz bu model, sıfır konfigürasyon ile doğrudan **Orkestratör** modeliniz olacaktır. İlk mesajınızı yazdığınızda Ollama otomatik olarak kurulacak ve yerel çevirmen devreye girecektir.

---

## 🛠️ Geliştirme ve Test Süreçleri

Projeye katkıda bulunurken veya kodları değiştirirken dikkat edilmesi gereken katı kurallar vardır (Bkz: `AGENTS.md` ve `plan.md`).

- **Tip Kontrolü (Typecheck):** Projede standart `tsc` yerine `tsgo` (`@typescript/native-preview`) kullanılır.
  ```bash
  bun run typecheck
  ```
- **Testler:**
  ```bash
  bun test packages/omo-opencode/src   # Hızlı testler
  bun test                             # Tüm testler
  ```

### `opencode-qa` (Kalite Güvence ve Hata Ayıklama)
Bu fork, OpenCode'un kendisini ve eklenti kancalarını (hooks) test etmek için gelişmiş bir `opencode-qa` yeteneğiyle gelir. Canlı veritabanınızı kirletmeden izole bir kum havuzunda (sandbox) çalışır.

- `opencode run` komutlarının davranışını CLI üzerinden test eder.
- SSE (Server-Sent Events) üzerinden belirli bir kancanın (hook) veya eklenti aksiyonunun gerçekten tetiklenip tetiklenmediğini kanıtlar.
- TUI (Terminal Arayüzü) smoke testlerini tmux altında otomatik çalıştırır.
*(Daha fazla detay için: `.agents/skills/opencode-qa/SKILL.md`)*

---

## 📜 Lisans

Orijinal kodlar © code-yeongyu ve katkıda bulunanlara aittir. 
Bu proje, orijinaliyle aynı olan **Sustainable Use License 1.0 (SUL-1.0)** altında lisanslanmıştır. 
- Sadece **ücretsiz, ticari olmayan kullanım ve dağıtıma** izin verilir.
- Lisans türü değiştirilemez (Örn: MIT yapılamaz).
- Bu dosyada ve diğer dosyalardaki tüm telif hakkı / modifikasyon uyarıları korunmalıdır.
