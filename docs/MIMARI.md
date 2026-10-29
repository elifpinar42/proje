# Mimari

## Bileşenler

```mermaid
flowchart LR
  subgraph Cocuk["Çocuk bilgisayarı (apps/desktop)"]
    W[Pencere izleme\nactive-win] --> R
    K[Klavye hızı\nnode-global-key-listener] --> R
    C[Kamera + face-api\n(renderer, yerel)] -->|duygu etiketi| R
    M[Mikrofon + Web Audio\n(renderer, yerel)] -->|ses seviyesi| R
    R[Risk motoru\n@dr/shared] --> Q[(Olay kuyruğu\nSQLite)]
    R --> UI[Çocuk ekranı\n+ rehberlik]
  end
  R -- "heartbeat / event\n(cihaz jetonu)" --> S
  UI -- "chat" --> S
  subgraph Sunucu["Sunucu (apps/server)"]
    S[Express API] --- DB[(SQLite)]
    S --> SSE[Canlı akış SSE]
    S --> AI[AiProvider\nUserKeyProvider]
    S --> PDF[PDF raporu]
    S --> Web[Statik panel]
  end
  AI -.-> Sag[OpenAI uyumlu\nAI sağlayıcısı]
  SSE --> P
  Web --> P[Ebeveyn paneli\napps/web]
  P -- "Bearer JWT + refresh çerezi" --> S
```

### Çalışma modları

| Mod | Nerede çalışır | Kim kullanır |
|---|---|---|
| **Gömülü** (varsayılan) | Masaüstü uygulamasının ana sürecinde `createServer()`; `127.0.0.1:3737` (isteğe bağlı `0.0.0.0` = yerel ağ) | Tek bilgisayar / evde yerel ağ |
| **Uzak sunucu** | `apps/server` ayrı süreç (Docker/VPS), varsayılan `:3000` | Ebeveynin başka yerden erişmesi |

Masaüstü uygulaması her iki modda da aynı HTTP API’yi kullanır; fark yalnızca `serverUrl`’dir.

## Veri akışı

1. Ebeveyn panelde hesap açar (kurtarma kodları gösterilir) → çocuk profili ekler → **6 haneli eşleştirme kodu** (10 dk, tek kullanımlık) üretir.
2. Masaüstü uygulaması `POST /api/agent/pair` ile kodu gönderir, **cihaz jetonu** (`drd_…`) alır; sunucuda yalnızca SHA-256 özeti saklanır.
3. Çocuğa rıza/açıklama ekranı gösterilir (hangi sinyaller açık).
4. Ajan, ebeveynin izin verdiği sinyalleri toplar. Her 10 sn’de `heartbeat` (risk, duygu, aktif süre), eşik aşılınca `event` gönderir. Sunucuya ulaşılamazsa olaylar yerel SQLite kuyruğunda birikir.
5. Sunucu veriyi kaydeder ve ebeveynin açık SSE bağlantılarına anında iletir.
6. Ayarlar sunucudan her nabızda döner; ebeveyn bir izni kapatınca ilgili modül ~10 sn içinde durur.

## Modüller

| Paket | Sorumluluk |
|---|---|
| `packages/shared` | `risk.ts` (saf risk fonksiyonları), `safety.ts` (sohbet güvenlik filtresi), `api.ts` (zod şemaları) |
| `apps/server/src` | `config` (anahtar üretimi), `db` (migrasyonlar), `security` (scrypt, AES-GCM, TOTP), `routes/{auth,parent,agent}`, `services/{ai,pdf,stats,retention}` |
| `apps/desktop/src/main` | `index` (yaşam döngüsü, tray, IPC), `agent` (risk motoru + sunucu iletişimi), `monitors`, `queue`, `store` |
| `apps/desktop/src/renderer` | React arayüzü, `vision.ts` (kamera + mikrofon) |
| `apps/web/src` | Ebeveyn paneli sayfaları |

## Risk puanı

Her sinyal 0–100 aralığında ham risk üretir (`packages/shared/src/risk.ts`):

| Sinyal | Ham risk |
|---|---|
| Pencere başlığı | **tüm açık pencerelerin** başlıkları 1,5 sn’de bir taranır; en riskli olan alınır. Yüksek riskli kelime (kumar, bahis, iddaa, casino, intihar, kendine zarar, uyuşturucu, …) → 85; orta riskli (bıçak, kavga, şiddet, silah, …) → 45 |
| Klavye | son 5 sn’deki tuş sayısı / 25 × 80 (en çok 100) |
| Ses | seviye > 80 → 85; > 65 → 45 (seviye: −60…0 dBFS → 0…100, 10 örnek hareketli ortalama) |
| Duygu | kararlı (son 5 ölçümde çoğunluk) duygu etiketi |

Toplam puan:

```
skor =  min(50, pencere × 0,6)
      + (ses > 40    ? min(25, (ses − 40) × 0,5) : 0)
      + (öfke 25 | korku 20 | üzüntü 15)
      + (klavye > 50 ? min(15, (klavye − 50) × 0,3) : 0)
nihai = yuvarla(skor × hassasiyet çarpanı)   // sınır: 0–100
nihai = en az 75, eğer pencere riski ≥ 80 ise  // yüksek riskli içerik hassasiyetten bağımsız olay üretir
```

| Hassasiyet | Çarpan | Olay eşiği |
|---|---|---|
| Düşük | 0,8 | 70 |
| Orta | 1,0 | 60 |
| Yüksek | 1,2 | 50 |

- **Olay:** puan ≥ eşik → sunucuya olay (ebeveyn bildirimi açıksa). Aynı durum için 60 sn beklenir; farklı bir riskli pencere açılırsa en fazla 5 sn sonra yeni olay gönderilir.
- **Rehberlik penceresi:** puan ≥ 75 ve son rehberlikten ≥ 120 sn → çocuk ekranında mola önerisi.

## Veritabanı

SQLite (`node:sqlite`), migrasyonlu şema (`PRAGMA user_version`). Tablolar: `users, recovery_codes, refresh_tokens, children, devices, pairing_codes, settings, events, heartbeats, ai_config, chat_logs, security_logs`. Çocuğa ait tüm satırlar `child_id → children.parent_id` zinciriyle ebeveyne bağlıdır ve her uç nokta bu sahipliği doğrular.

`ai_config.mode` alanı `own_key | managed` değerini alır; yalnızca `own_key` uygulanmıştır. AI çağrıları `AiProvider` arayüzünün arkasındadır (`UserKeyProvider`); ileride ücretli sürümde `ManagedProvider` + kullanım sayacı eklenebilir.

## Sohbet güvenlik filtresi

Çocuğun her sohbet mesajı **AI’dan önce** yerel anahtar kelime filtresinden geçer (`checkChildMessage`). Eşleşirse hazır güvenli yanıt verilir, AI çağrılmaz ve ebeveyne `source: chat` olayı düşer (kritik: 90, uyarı: 65).
