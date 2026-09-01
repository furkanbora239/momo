# momo (My Oh My Openagent) — Kapsamlı Kullanım Kılavuzu & Rehber

Bu belge, **momo** (OpenCode için çok modelli, token verimli orkestrasyon eklentisi) eklentisinin nasıl çalıştığını, tüm komutlarını, ajan mimarisini, yapılandırmasını ve en iyi kullanım pratiklerini ayrıntılı olarak açıklamaktadır.

---

## 📑 İçindekiler

1. [Genel Bakış ve Çalışma Mantığı (Mimari)](#1-genel-bakış-ve-çalışma-mantığı-mimari)
2. [Kurulum ve Hızlı Başlangıç](#2-kurulum-ve-hızlı-başlangıç)
3. [Slash Komutları Kılavuzu (`/komut`)](#3-slash-komutları-kılavuzu-komut)
   - [`/help` — İnteraktif Yardım](#help--i̇nteraktif-yardım)
   - [`/advisor` — İsteğe Bağlı Danışman Model](#advisor--i̇steğe-bağlı-danışman-model)
   - [`/goal` — Kesintisiz Görev Döngüsü](#goal--kesintisiz-görev-döngüsü)
   - [`/refactor` — Akıllı Yeniden Yapılandırma](#refactor--akıllı-yeniden-yapılandırma)
   - [`/hyperplan` — Çekişmeli Çok Ajanlı Planlama](#hyperplan--çekişmeli-çok-ajanlı-planlama)
   - [`/start-work` — Plan Uygulama ve Başlatma](#start-work--plan-uygulama-ve-başlatma)
   - [`/handoff` — Oturum Özeti ve Devir](#handoff--oturum-özeti-ve-devir)
   - [`/remove-ai-slops` — Yapay Zeka Şişkinliklerini Temizleme](#remove-ai-slops--yapay-zeka-şişkinliklerini-temizleme)
   - [`/stop-continuation` — Döngüleri Durdurma](#stop-continuation--döngüleri-durdurma)
   - [`/security-research` — Güvenlik Denetimi](#security-research--güvenlik-denetimi)
   - [`/remove-deadcode` — Ölü Kod Temizleme](#remove-deadcode--ölü-kod-temizleme)
   - [`/get-unpublished-changes` — Değişiklik Özeti](#get-unpublished-changes--değişiklik-özeti)
   - [`/publish` — Otomatik Paket Yayınlama](#publish--otomatik-paket-yayınlama)
4. [Ajan Rolleri ve Görev Dağılımı](#4-ajan-rolleri-ve-görev-dağılımı)
5. [CLI (Terminal) Komutları](#5-cli-terminal-komutları)
6. [Yapılandırma Dosyası (`~/.omo/omo.jsonc`)](#6-yapılandırma-dosyası-omoomojsonc)
7. [Gelişmiş Teknolojiler & İç Mekanizmalar](#7-gelişmiş-teknolojiler--i̇ç-mekanizmalar)
8. [Sorun Giderme ve Sık Sorulan Sorular](#8-sorun-giderme-ve-sık-sorulan-sorular)

---

## 1. Genel Bakış ve Çalışma Mantığı (Mimari)

Standart yapay zeka kodlama araçları, her istekte devasa dosya ağaçlarını ve tüm sohbet geçmişini doğrudan en pahalı bayrak gemisi modellere (Claude Opus, GPT-5, Gemini Pro vb.) gönderir. Basit bir imla hatası veya tek satırlık fonksiyon için milyonlarca token harcanır.

**momo'nun Temel Felsefesi:**
> **Hafif ve ucuz bir Orkestratör (Teknik Lider), işi doğrudan kendisi yazmak yerine planlar, repo haritasını inceler, görevi Live Catalog MCP üzerinden en ucuz ve yeterli alt ajanlara delege eder. Kullanıcı prompt'ları yerel Ollama modeliyle sıkıştırılır. Pahalı modeller ise sadece gerektiğinde `/advisor` komutuyla danışman olarak çağrılır.**

```
                      ┌────────────────────────────────────────┐
                      │    Kullanıcı İstemi (Prompt / Soru)    │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌────────────────────────────────────────┐
                      │    Yerel Çevirici / Sıkıştırıcı        │
                      │    (Ollama / Qwen 2.5 1.5B)            │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌────────────────────────────────────────┐
                      │    Ana Orkestratör (Sisyphus)          │
                      │    - Repo haritasını inceler           │
                      │    - Görev planı hazırlar              │
                      │    - İşi alt ajanlara dağıtır          │
                      └───────┬────────────────────────┬───────┘
                              │                        │
       [Rutin Görevler]       │                        │  [Kritik Mimari Sorular]
                              ▼                        ▼
     ┌─────────────────────────────────┐      ┌────────────────────────┐
     │   Dinamik Model Kataloğu (MCP)  │      │   Bağlı Danışman       │
     │   (`catalog_pick`)              │      │   (Opus 5 / Sol 5.6)   │
     │   -> quick, deep, visual        │      │   via `/advisor`       │
     └─────────────────────────────────┘      └────────────────────────┘
```

---

## 2. Kurulum ve Hızlı Başlangıç

### Adım 1: Depoyu Klonlayın ve Bağımlılıkları Yükleyin
```bash
git clone https://github.com/furkanbora239/momo.git
cd momo
bun install
```

### Adım 2: Eklentiyi Derleyin
```bash
bun run build
```

### Adım 3: OpenCode Yapılandırmasına Ekleyin
`~/.config/opencode/opencode.json` veya proje dizinindeki `opencode.json` dosyasına eklenti yolunu ekleyin:

```json
{
  "plugin": [
    "/home/kullanici_adi/code/ai/momo"
  ]
}
```

### Adım 4: OpenCode'u Başlatın
```bash
opencode
```
1. OpenCode içinde `/models` yazarak kullanmak istediğiniz ana modeli seçin.
2. Seçtiğiniz model anında **momo Orkestratörü** olarak devreye girer. Sıfır ek ayar gerektirir!

---

## 3. Slash Komutları Kılavuzu (`/komut`)

momo, OpenCode TUI veya web arayüzünde doğrudan kullanabileceğiniz güçlü yerleşik komutlar sunar:

### `/help` — İnteraktif Yardım
- **Amaç:** Eklenti hakkındaki tüm komutları, ajanları ve kullanım yöntemlerini listeler veya belirli bir konu hakkında derinlemesine rehberlik sağlar.
- **Kullanım Biçimleri:**
  ```text
  /help
  /help advisor
  /help goal
  /help refactor
  /help config
  /help agents
  ```
- **Ne Yapar?** Argümansız çağrıldığında genel referans tablosunu gösterir. Belirli bir konu girildiğinde ise o komutun parametrelerini, örneklerini ve çalışma detaylarını anlatır.

---

### `/advisor` — İsteğe Bağlı Danışman Model
- **Amaç:** Pahalı bayrak gemisi modelleri (Claude Opus 5, GPT-5.6 Sol, Gemini 3 Pro) sürekli çalıştırmak yerine sadece zorlu mimari kararlarda veya tıkanılan hatalarda geçici olarak oturuma bağlar.
- **Kullanım Biçimleri:**
  ```text
  /advisor anthropic/claude-opus-5    # Danışman modeli bu oturuma bağlar
  /advisor openai/gpt-5.6-sol          # OpenAI modelini bağlar
  /advisor report                      # Mevcut danışman durumunu gösterir
  /advisor off                         # Danışman bağını kaldırır
  ```
- **Nasıl Çalışır?** Danışman bağlı değilken sisteme ekstra maliyet gelmez (zero-cost). Bağlandığında orkestratör zorlu soruları danışmana sorar ve danışman tüm kod yerine yalnızca kısa, net direktifler (<300 token) döner.

---

### `/goal` — Kesintisiz Görev Döngüsü
- **Amaç:** Çok adımlı, uzun süren bir hedef belirler. Ajan hedef tamamlanana veya tüm testler geçene kadar durmadan adımları takip eder.
- **Kullanım Biçimleri:**
  ```text
  /goal Auth modülünü JWT tabanlı sisteme geçir ve tüm testleri yeşile çevir
  /goal pause     # Döngüyü duraklatır
  /goal resume    # Duraklatılan hedefi devam ettirir
  /goal clear     # Aktif hedefi temizler
  ```

---

### `/refactor` — Akıllı Yeniden Yapılandırma
- **Amaç:** LSP (Language Server Protocol) ve AST-Grep desteğiyle kod tabanını güvenle yeniden yapılandırır.
- **Kullanım Biçimleri:**
  ```text
  /refactor packages/omo-opencode/src/tools --scope=module --strategy=safe
  /refactor src/auth.ts --strategy=aggressive
  ```
- **Nasıl Çalışır?** Kod haritasını inceler, tip hatalarını (LSP) kontrol eder, AST analizleri yapar, değişiklikleri hashline ile uygular ve testlerle doğrular.

---

### `/hyperplan` — Çekişmeli Çok Ajanlı Planlama
- **Amaç:** Karmaşık ve kritik özellikler için 5 farklı uzman ajanı (derin mantık, mimari, tasarım, şüpheci eleştirmen) karşı karşıya getirir; birbirlerinin planlarını çürütüp en sağlam yol haritasını çıkarır.
- **Kullanım Biçimleri:**
  ```text
  /hyperplan Redis tabanlı distributed rate limiting altyapısı kurmak istiyoruz
  ```

---

### `/start-work` — Plan Uygulama ve Başlatma
- **Amaç:** Hazırlanmış bir iş planını alır, git worktree oluşturur, alt görevleri sırayla veya paralel olarak subagent'lara dağıtarak uygular.
- **Kullanım Biçimleri:**
  ```text
  /start-work
  /start-work plan-adi --worktree ./feature-auth --make-pr
  ```

---

### `/handoff` — Oturum Özeti ve Devir
- **Amaç:** Mevcut oturum çok uzadığında ve token limiti dolmaya başladığında, yapılan işleri, açık kalan görevleri ve önemli kararları özetleyen temiz bir devir raporu üretir.
- **Kullanım Biçimleri:**
  ```text
  /handoff
  /handoff "Yeni oturumda frontend entegrasyonuna devam edilecek"
  ```
- **Nasıl Kullanılır?** Çıktıyı kopyalayın, OpenCode'da yeni bir oturum (`n`) açın ve ilk mesaj olarak yapıştırın.

---

### `/remove-ai-slops` — Yapay Zeka Şişkinliklerini Temizleme
- **Amaç:** Kod içine eklenmiş gereksiz yapay zeka açıklamalarını ("Sure, here is the function", "This function simply does X..."), fazla şablon kodları ve gereksiz yorum satırlarını temizler.
- **Kullanım Biçimleri:**
  ```text
  /remove-ai-slops
  /remove-ai-slops src/components/
  ```

---

### `/stop-continuation` — Döngüleri Durdurma
- **Amaç:** Arka planda çalışan tüm devam döngülerini (goal loop, todo enforcer, arka plan alt görevleri) anında iptal eder ve sistemi boşta durumuna getirir.
- **Kullanım Biçimleri:**
  ```text
  /stop-continuation
  ```

---

### Proje ve Güvenlik Komutları:
- `/security-research`: Paralel çalışan 3 açık avcısı ve 2 PoC mühendisi ile projede derinlemesine güvenlik açığı araştırması yapar.
- `/remove-deadcode`: LSP ile referansları kontrol ederek projede kullanılmayan ölü fonksiyon ve değişkenleri temizler.
- `/get-unpublished-changes`: Git HEAD ile yayınlanmış son sürümü kıyaslayıp değişiklikleri raporlar.
- `/publish <patch|minor|major>`: Projeyi otomatik olarak derler, test eder ve GitHub Actions üzerinden yeni sürümü yayınlar.

---

## 4. Ajan Rolleri ve Görev Dağılımı

momo, karmaşık ajan hiyerarşileri yerine net ve odaklı bir ajan kadrosu kullanır:

| Ajan Adı | Rolü | Ne Zaman Devreye Girer? |
| :--- | :--- | :--- |
| **momo Orchestrator (`sisyphus`)** | Teknik Lider / Koordinatör | Her zaman devrededir. Görevleri planlar, alt ajanlara dağıtır. `/models` ile seçtiğiniz modeli kullanır. |
| **`explore`** | Kod Arama Uzmanı | Yerel kod tabanında sembol, fonksiyon ve referans aramalarında hızlı arama yapar. |
| **`librarian`** | Harici Araştırma Uzmanı | Web araması, üçüncü parti kütüphane dokümanları ve API araştırmalarında devreye girer. |
| **`advisor`** | Kıdemli Mimar (İsteğe Bağlı) | Yalnızca `/advisor` ile bağlandığında mimari tavsiye verir. Asla kendisi kod yazarak token yakmaz. |

### Alt Ajan Kategori Yönlendirmesi (`task(category=...)`):
Orkestratör bir alt görev açtığında işin türüne göre şu kategorileri seçer:
- **`quick`:** Küçük tek dosyalı düzeltmeler, yazım hataları, küçük fonksiyonlar (hızlı flash modelleri seçilir).
- **`deep`:** Çok dosyalı mimari değişiklikler ve kapsamlı özellik geliştirmeleri.
- **`visual-engineering`:** Frontend arayüzü, CSS, Tailwind ve görsel bileşen tasarımı.
- **`ultrabrain`:** İleri düzey algoritmalar, performans optimizasyonu ve karmaşık mantık problemleri.

---

## 5. CLI (Terminal) Komutları

Terminalinizden `oh-my-opencode` (veya `omo`) komut satırı aracını doğrudan çalıştırabilirsiniz:

```bash
# 1. Sağlık ve Teşhis Raporu
bunx oh-my-opencode doctor            # Sorunları ve eksik ayarları gösterir
bunx oh-my-opencode doctor --status   # Kompakt gösterge paneli
bunx oh-my-opencode doctor --verbose  # Tüm sağlayıcı ve model detayları

# 2. İnteraktif Kurulum
bunx oh-my-opencode install           # Sağlayıcıları ve anahtarları yapılandırır

# 3. Görev Odaklı Çalıştırma (Enforcement)
bunx oh-my-opencode run "Kullanıcı kayıt testlerini düzelt"
# Bu komut tüm todolar bitene ve arka plan ajanları işini tamamlayana kadar bekler!

# 4. Yapılandırma Taşıma (Migration)
bunx oh-my-opencode config migrate    # Eski ayarları ~/.omo/omo.jsonc dosyasına taşır
```

---

## 6. Yapılandırma Dosyası (`~/.omo/omo.jsonc`)

momo ayarları `~/.omo/omo.jsonc` (global) veya projenizdeki `.opencode/oh-my-openagent.jsonc` üzerinden özelleştirilebilir:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/furkanbora239/momo/dev/assets/oh-my-opencode.schema.json",

  // 1. Yerel Prompt Sıkıştırıcı (Ollama)
  "local_translator": {
    "enabled": true,                  // Yerel model ile çeviri ve token sıkıştırma
    "model": "qwen2.5:1.5b",           // Ollama model etiketi (veya 'gemma3:1b')
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": true,             // Ollama yoksa otomatik kur
    "min_length": 20                  // 20 karakterden kısa girdileri doğrudan geçir
  },

  // 2. Dinamik Model Kataloğu MCP
  "catalog": {
    "enabled": true                   // Bağlı sağlayıcılardan en ucuz modeli dinamik seç
  },

  // 3. Kalıcı Danışman Modeli (İsteğe Bağlı)
  "agents": {
    "advisor": {
      "model": "anthropic/claude-opus-5"
    }
  },

  // 4. Kategoriye Göre Model Atama
  "categories": {
    "quick": {
      "model": "google/gemini-3-flash"
    },
    "deep": {
      "model": "neuralwatt/glm-5.2"
    },
    "ultrabrain": {
      "model": "openai/gpt-5.6-sol"
    }
  },

  // 5. Devre Dışı Bırakılacak Komutlar / Hook'lar (Token tasarrufu)
  "disabled_hooks": [
    // "todoDescriptionOverride"
  ]
}
```

---

## 7. Gelişmiş Teknolojiler & İç Mekanizmalar

1. **Local Prompt Translator (Ollama Entegrasyonu):**
   Kullanıcının yazdığı uzun veya yabancı dildeki prompt'ları buluta göndermeden önce yerel makinede çalışan hafif bir modelle (`qwen2.5:1.5b`) İngilizceye çevirir ve öz "Caveman" stiline sıkıştırır. Bu işlem hem girdi hem çıktı token masrafını %40-70 oranında düşürür.

2. **Live Catalog MCP (`catalog_pick`):**
   Eklenti açıldığında bağlı tüm sağlayıcıları (`client.provider.list()`) tarar. Bir alt görev delege edileceği zaman yerel sezgisel puanlamayla o görevi yapabilecek en ucuz modeli milisaniyeler içinde seçer.

3. **Hashline (Hash-Anchored Edits):**
   Ajanların okuduğu her kod satırı `LINE#HASH` formatında etiketlenir. Düzenleme yapılırken satırın içeriğinin değişip değişmediği doğrulanır; böylece yapay zekanın yanlış satırı değiştirmesi veya kodu bozması engellenir.

4. **Repo-Map Auto-Injector:**
   İlk turda projenin sembol haritasını, önemli sınıflarını ve dosya bağımlılıklarını orkestratöre otomatik olarak sunar. Ajanın saatlerce gereksiz `grep` ve `find` aramaları yapmasını önler.

---

## 8. Sorun Giderme ve Sık Sorulan Sorular

### S: `/advisor` modeline danışmak istediğimde hata alıyorum?
**C:** Danışman model varsayılan olarak serbest bırakılmıştır (bağlı değildir). Kullanmadan önce `/advisor <model_adi>` (örneğin `/advisor anthropic/claude-opus-5`) yazarak bağlamalısınız veya `~/.omo/omo.jsonc` içinde `agents.advisor.model` tanımlamalısınız.

### S: Ollama çalışmıyor veya çeviri gecikiyor?
**C:** Terminalde `ollama serve` komutunun çalıştığından ve `ollama pull qwen2.5:1.5b` modelinin indiğinden emin olun. Yerel çeviriciyi kapatmak isterseniz `omo.jsonc` içinde `"local_translator": { "enabled": false }` yapabilirsiniz.

### S: Plugin'in sağlık durumunu nasıl kontrol edebilirim?
**C:** Terminalde `bunx oh-my-opencode doctor --verbose` komutunu çalıştırarak bağlı API anahtarlarını, model izinlerini ve MCP sunucularını denetleyebilirsiniz.
