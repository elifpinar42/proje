# Dijital Rehberlik — Yeniden Yapılandırma, Dokümantasyon ve Derleme Planı

> **Bu onaydan sonraki tek adım:** Bu plan proje klasörüne `docs/YENIDEN-YAPILANDIRMA-PLANI.md` olarak kaydedilecek. Uygulamaya (Faz 0 ve sonrası) **başlanmayacak**; kullanıcı ayrıca "başla" diyene kadar beklenir.

## Context

Proje (Electron + ayrı `node` süreciyle Express + JSON dosya "DB" + tek parça `frontend/app.js`) bir prototip. Kod okuması ve kısa çalıştırma ile doğrulananlar:

- **Backend çalışıyor ama `.env` hiç yüklenmiyor** (`injected env (0)`): `main.js` backend'i proje kökünden başlatıyor, `.env` ise `backend/` altında. Sonuç: `index.js` token'ı `access-token-secret-key-32chars-min` ile imzalıyor, `middleware/auth.js` ise `super-secret-key` ile doğruluyor → **girişten sonra korumalı tüm uç noktalar 403 döner** (kod okumasıyla tespit; Faz 0'da istekle doğrulanacak).
- `src/modules/emotion.js` sözdizimi hatalı; `mouse.js` 0 bayt; `src/modules/riskEngine.js` ölü kopya.
- Kamera duygu analizi hiç çalışmıyor (`canvas` kurulu değil); SoX kurulu değil, mikrofon sabit cihaz adına bağlı.
- Güvenlik: `nodeIntegration:true`/`contextIsolation:false`, her origin'e açık CORS + credentials, refresh'te rol `parent`'a dönüşüyor, kayıtta herkes ebeveyn olabiliyor, çocuk tüm raporları okuyup yazabiliyor, iki süreç aynı JSON dosyalarına kilitsiz yazıyor.
- Sahte veriler: "2 saat 40 dakika", PDF'teki uydurma duygu dağılımı, üretim arayüzünde test düğmeleri.
- `baslat.bat` başka bir kullanıcının yoluna (`C:\Users\pelif\...`) sabitlenmiş; README, test, paketleme yok.

Ayrıntılı önceki analiz `proje-analiz.html` içinde (takip edilmeyen dosya).

**Kullanıcının kararları:**
1. Mimari: **Electron + TypeScript + React/Vite + SQLite + electron-builder** (modern masaüstü).
2. Ebeveyn paneli **bir sunucuya konabilmeli** ve **yerel ağda da çalışabilmeli** → sunucu Electron'dan bağımsız, iki modda çalışan ayrı bir paket olmalı.
3. AI: **İsteğe bağlı**; sabit sağlayıcı yok, şimdilik tek kullanıcı → herkes kendi API anahtarını ve modelini **ebeveynin Ayarlar** sayfasından girer. İleride ücretli sürümde AI'ı biz sağlayacağız (mimari buna hazır bırakılır, şimdi uygulanmaz).

**Hedef:** Çalışır, derlenmiş (Windows kurulum `.exe` + sunucu Docker imajı), belgelenmiş, test edilmiş bir proje.

## Hedef Mimari

```
dijital-rehberlik/               (npm workspaces monorepo)
├─ apps/
│  ├─ server/    Express 5 + TS + SQLite. Ebeveyn web panelini de statik sunar.
│  │             Mod 1: masaüstüne gömülü (LAN, 0.0.0.0 opsiyonel)  Mod 2: uzak sunucu (Docker)
│  ├─ web/       React + Vite: ebeveyn paneli (giriş, canlı durum, geçmiş, ayarlar, AI ayarları, PDF, 2FA, oturumlar)
│  └─ desktop/   electron-vite: çocuk cihazındaki ajan
│                 main: izleme (pencere, klavye), risk motoru, sunucuya olay gönderimi, tray
│                 preload: contextBridge ile dar API
│                 renderer (React): çocuk ekranı, AI sohbet, rehberlik modalı, kamera+mikrofon analizi
├─ packages/shared/   TS tipleri, API sözleşmesi (zod şemaları), risk motoru (saf fonksiyon)
├─ docs/              dokümantasyon
└─ models/            face-api model ağırlıkları (desktop'a paketlenir)
```

**Akış:** Ebeveyn sunucuda hesap açar → panelde çocuk profili oluşturur → 6 haneli **eşleştirme kodu** üretir → çocuk bilgisayarındaki masaüstü uygulaması ilk açılışta sunucu adresi + kodu ile eşleşir ve **cihaz jetonu** alır → ajan, ebeveynin izin verdiği sinyalleri toplar, risk puanını hesaplar, olayları ve 10 sn'lik durum nabzını sunucuya gönderir → ebeveyn paneli canlı durumu (SSE) ve geçmişi gösterir. Sunucu adresi varsayılan olarak masaüstüne gömülü yerel sunucudur; ayarlardan uzak sunucuya çevrilir.

**Önemli teknik kararlar:**
- **SQLite:** `node:sqlite` (Node 24 / Electron 43 içinde yerleşik, native derleme yok). Faz 0'da Electron içinde çalıştığı doğrulanır; olmazsa `better-sqlite3` + `electron-builder install-app-deps`. Şema migrasyonlu: `users, children, devices, pairing_codes, events, heartbeats, settings, ai_config, chat_logs, sessions, refresh_tokens, security_logs`. Tüm satırlar `parent_id`/`child_id` ile sahiplenilir (IDOR biter).
- **Kamera:** face-api renderer'a taşınır (`@vladmandic/face-api`, tfjs 4 uyumlu, tarayıcı canvas'ı kullanır). Sadece duygu etiketi/yüzdeler IPC ile main'e gider; görüntü cihazdan çıkmaz.
- **Mikrofon:** SoX tamamen kalkar; renderer'da Web Audio API ile göreli ses seviyesi ölçülür (mevcut `startAudioAnalyser` mantığı yeniden kullanılır).
- **Pencere:** `active-win@8` korunur. **Klavye:** yalnızca ebeveyn izin verirse; `node-global-key-listener` doğru paket adıyla bağımlılığa eklenir.
- **Risk motoru:** `src/core/riskEngine.js` ağırlıkları `packages/shared/risk.ts` içine saf fonksiyon olarak taşınır, `sensitivity` ayarı gerçekten uygulanır, birim testi yazılır.
- **AI (isteğe bağlı):** Uygulama AI olmadan tam çalışır. Ebeveynin **Ayarlar** sayfasında isteğe bağlı bir "AI Asistanı" bölümü: **API taban URL'si, API anahtarı, model adı** (OpenAI uyumlu `/chat/completions` formatı; OpenAI, OpenRouter, Ollama, Gemini/Claude'un OpenAI-uyumlu uçları ile çalışır). Şimdilik herkes kendi API anahtarını girer. Anahtar sunucuda AES-256-GCM ile şifreli saklanır, hiçbir istemciye geri dönmez, "Bağlantıyı test et" düğmesi olur. Çağrılar yalnızca sunucudan yapılır. AI ayarlanmamışsa çocuk ekranındaki sohbet sekmesi gizlenir (veya "Asistan kapalı" der). **Varsayım:** mevcut uydurma "bilgi tabanı" yanıtları kaldırılır; çocuğun sorusundaki tehlike/kişisel bilgi anahtar kelime kontrolü (güvenlik filtresi) korunur ve ebeveyne olay olarak düşer. Gemini/OpenAI'ye özel kod silinir.
  - **İleriye dönük (bu kapsamda yapılmayacak):** Ücretli sürümde AI'ı biz sağlayacağız. Bunun için AI çağrısı tek bir `AiProvider` arayüzünün arkasında tutulur (`UserKeyProvider` şimdi; ileride `ManagedProvider` + kullanım sayacı/abonelik eklenebilir). `ai_config` tablosunda `mode: 'own_key' | 'managed'` alanı şimdiden bulunur, yalnızca `own_key` uygulanır.
- **Electron güvenliği:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload + contextBridge, CSP, `innerHTML` yok (React).
- **Kimlik doğrulama:** Rol jetona yazılır ve refresh'te korunur; kayıt yalnızca ebeveyn (çocuk hesabı yok, cihaz eşleştirmesi var); access 15 dk + refresh 7 gün (HttpOnly cookie, rotation); 401/403 tutarlı; şifre sıfırlama güvenlik sorusu yerine **kurtarma kodları** (2FA kurtarma kodlarıyla aynı mekanizma); JWT/şifreleme anahtarları yoksa ilk açılışta rastgele üretilip veri klasörüne yazılır (sabit varsayılan yok). CORS: izinli origin listesi (env). Rate limit korunur.
- **Veri yeri:** Masaüstünde `app.getPath('userData')`, sunucuda `DATA_DIR` env. Saklama süresi ayarı + "tüm verileri sil".
- **PDF:** pdfkit + gömülü Unicode font (Noto Sans, Türkçe karakter), yalnızca gerçek veri (ekran süresi `heartbeats`'ten hesaplanır).
- **Mevcut yeniden kullanılacaklar:** `backend/services/twoFactorService.js` (TOTP/kurtarma), `backend/middleware/security.js` (helmet/rate limit ayarları), `backend/services/pdfService.js` (düzen), `src/monitoring/screen.js` anahtar kelime listeleri, `src/core/riskEngine.js` ağırlıkları + `buildRealtimeChildStatus`, `frontend/app.js` içindeki ses analizi ve kamera kare döngüsü, `frontend/index.html` görsel dili (renkler/Outfit fontu).

## Uygulama Fazları

### Faz 0 — Temel çizgi ve temizlik
- Yeni dal `yeniden-yapilandirma`. Mevcut kod `legacy/` altına taşınmaz; git geçmişi yeterli, eski dosyalar fazlar ilerledikçe silinir.
- 403 hatasını kayıt→giriş→`/api/reports` isteğiyle doğrula ve not et.
- `node:sqlite`'ın Electron 43 içinde çalıştığını küçük bir betikle doğrula.
- Çalışma ağacındaki silinmiş `proje.pdf`, `test_*.pdf` → kullanıcıya sorulmadan geri alınmaz; `proje.pdf` (proje şartnamesi) `docs/` altına geri getirilmesi önerilir. `backend/data/users.db` ve veri dosyaları git'ten çıkarılır, `.gitignore` güncellenir.
- **Doğrulama:** `git status` temiz, eski uygulamanın davranışı not edildi.

### Faz 1 — Monorepo iskeleti ve araç zinciri
- Kök `package.json` workspaces, `tsconfig.base.json`, ESLint + Prettier, Vitest, `.editorconfig`, `.nvmrc` (Node 24).
- Betikler: `dev` (server+web+desktop), `build`, `test`, `lint`, `typecheck`, `dist:win`, `docker:build`.
- Kullanılmayan bağımlılıklar çıkar: `nedb`, `mic`, `node-mic`, `node-record-lpcm16`, kök `express`/`@tensorflow/tfjs`, Capacitor yapılandırması.
- **Doğrulama:** `npm install && npm run typecheck && npm run lint` hatasız.

### Faz 2 — `apps/server`
- Katmanlar: `config` (env + otomatik anahtar üretimi), `db` (migrasyonlar, repository'ler), `auth` (JWT, rol, refresh rotation, 2FA, kurtarma), `routes/` (auth, children, devices/pairing, agent (cihaz jetonlu: events, heartbeat, settings), events/history, summary, reports/pdf, ai (config + chat), security), `services/` (ai, pdf, retention), `sse` (canlı durum).
- `GET /api/health` eklenir. Tek merkezi hata yakalayıcı, zod ile girdi doğrulama (mevcut kaba `sanitizeInput` kalkar; çıktı React tarafında kaçışlanır).
- Gömülebilir: `createServer({ dataDir, host, port })` dışa aktarılır; bağımsız giriş noktası `src/standalone.ts`.
- `Dockerfile` + `docker-compose.yml` (volume ile `DATA_DIR`).
- **Doğrulama:** Vitest + supertest: kayıt/giriş/refresh rol korunuyor, çocuk–ebeveyn sahiplik (başka ebeveynin verisi 403/404), eşleştirme akışı, AI anahtarı yanıtlarda hiç dönmüyor, PDF `application/pdf` üretiyor.

### Faz 3 — `apps/web` (ebeveyn paneli)
- Sayfalar: Giriş/Kayıt/Kurtarma, Genel bakış (canlı durum, bugünkü özet), Geçmiş (filtreli), Çocuklar & Cihazlar (eşleştirme kodu), Ayarlar (izinler, hassasiyet, saklama süresi), AI Ayarları (URL/anahtar/model + test), Güvenlik (2FA kurulumu, oturumlar, güvenlik logları), PDF indirme.
- API istemcisi: access token bellekte, refresh cookie ile otomatik yenileme.
- Mobil uyumlu (telefon tarayıcısı için). `vite build` çıktısı sunucu tarafından statik sunulur.
- **Doğrulama:** Tarayıcıda (in-app browser) uçtan uca: kayıt → çocuk ekle → kod al → ayar kaydet; telefon genişliğinde (375px) düzen kontrolü.

### Faz 4 — `apps/desktop` (çocuk ajanı)
- main: tek örnek kilidi, tray (gerçek `.ico`), gömülü sunucuyu `createServer` ile aynı süreçte başlatma (uzak sunucu seçiliyse başlatmaz), ilk açılış sihirbazı (sunucu adresi + eşleştirme kodu + çocuğa açıklama/rıza ekranı), izleme modülleri (`monitors/window.ts`, `monitors/keyboard.ts`), risk motoru, olay kuyruğu (çevrimdışıyken SQLite'ta biriktir, sonra gönder), ayarları sunucudan periyodik çekip izinlere göre modülleri aç/kapat, otomatik başlatma.
- preload: `window.agent = { onState, onGuidance, sendEmotion, sendAudioLevel, ... }`.
- renderer (React): çocuk ekranı (duygu çubukları, canlı rehber), AI sohbet (sunucu üzerinden), sesle giriş/sesli okuma (mevcut Web Speech mantığı), rehberlik modalı. Test düğmeleri yalnız `import.meta.env.DEV`'de.
- Sahte veriler tamamen kalkar.
- **Doğrulama:** `npm run dev` ile uygulama açılır; eşleştirme yapılır; "kumar" içeren bir pencere başlığı açıldığında ≥60 risk olayı panelde görünür; kamera izni verilince yüz ifadesi yüzdeleri değişir; izin kapatılınca modül durur.

### Faz 5 — Paketleme ve derleme
- `electron-builder` (NSIS, Windows x64): `models/`, uygulama ikonu, `node-global-key-listener`'ın `WinKeyServer.exe` dosyası `asarUnpack`. `baslat.bat` silinir (kurulum kısayolu yerini alır).
- Sunucu: `npm run build -w apps/server` + Docker imajı.
- **Doğrulama:** `npm run dist:win` → `dist/Dijital Rehberlik Setup x.y.z.exe` oluşur; kurulu uygulama açılır, gömülü sunucu `/api/health` 200 döner; `docker compose up` ile sunucu ayağa kalkar ve panel tarayıcıda açılır; masaüstü uzak sunucuya (Docker) eşleşip olay gönderir.

### Faz 6 — Dokümantasyon (`docs/` + kök `README.md`)
- `README.md`: ne olduğu, ekran görüntüsü, hızlı başlangıç, betikler.
- `docs/MIMARI.md`: bileşenler, veri akışı diyagramı (Mermaid), modüller, risk puanı formülü.
- `docs/KURULUM.md`: geliştirici ortamı, masaüstü kurulum, sunucuya (Docker/VPS) kurulum, LAN erişimi, env değişkenleri tablosu.
- `docs/API.md`: tüm uç noktalar, yetki gereksinimi, örnek istek/yanıt.
- `docs/GUVENLIK-GIZLILIK.md`: tehdit modeli, veri saklama, hangi veri nereye gider, KVKK notları, AI anahtarı yönetimi.
- `docs/KULLANIM.md`: ebeveyn ve çocuk için adım adım.
- `docs/YOL-HARITASI.md`: bu plandaki fazlar + sonraki özellikler (web filtresi, uygulama süre limiti, mobil uygulama, push bildirimi).
- `CHANGELOG.md`, `.env.example` (server ve desktop).

### Faz 7 — Son doğrulama
- `npm run lint && npm run typecheck && npm test && npm run build && npm run dist:win` hepsi yeşil.
- Uçtan uca senaryo (yukarıdaki Faz 4/5 doğrulamaları) kurulu `.exe` üzerinde tekrar.
- Sonuçlar (geçen/kalan, doğrulanamayan donanım kısımları — ör. gerçek mikrofon/kamera) dürüstçe raporlanır.

## Kritik dosyalar
- Silinecek/taşınacak: `main.js`, `backend/**`, `frontend/**`, `src/**`, `baslat.bat`, `capacitor.config.json`, kök `package.json` (yeniden yazılır).
- Yeni: `apps/server/src/{app.ts,standalone.ts,config.ts,db/*,routes/*,services/*}`, `apps/web/src/**`, `apps/desktop/src/{main,preload,renderer}/**`, `packages/shared/src/{api.ts,risk.ts}`, `electron-builder.yml`, `Dockerfile`, `docs/*`.

## Açık riskler
- `node-global-key-listener` bazı antivirüslerde uyarı verebilir (global klavye kancası) — dokümante edilir, ayarla kapatılabilir.
- Gerçek kamera/mikrofon testi otomatik yapılamaz; manuel kontrol listesi docs'ta olacak.
- Kod imzalama sertifikası yok → Windows SmartScreen uyarısı beklenir.
