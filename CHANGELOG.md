# Değişiklik günlüğü

## 2.0.2

- Ebeveyn panelinde her ekran boyutunda yan menü (mobilde açılır çekmece); alt menü kaldırıldı.
- Çocuk uygulamasındaki “Ayarlar” kaldırıldı: otomatik başlatma artık ebeveyn panelinden (Ayarlar → izinler) yönetilir.
- Gömülü sunucu her zaman yerel ağa açık; panel adresleri ebeveyn panelinde (Çocuklar sayfası) gösterilir.
- Çocuk cihazındaki eşleşme yalnızca ebeveynin ürettiği 6 haneli “kaldırma kodu” ile kaldırılabilir.

## 2.0.1

- Tepsi (tray) simgesi kurulu sürümde görünmüyordu: simge dosyaları pakete eklendi.
- Kamera/mikrofon: izin denetimi düzeltildi, izinler ilk açılışta isteniyor, hata mesajları gerçek nedeni söylüyor, meşgul cihazda otomatik yeniden deneme.

## 2.0.0 — Yeniden yapılandırma

Prototip (Electron + JSON dosya “veritabanı” + tek parça `app.js`) baştan yazıldı.

### Eklenenler
- npm workspaces monorepo: `apps/server`, `apps/web`, `apps/desktop`, `packages/shared`.
- Sunucu: Express 5, `node:sqlite` (migrasyonlu), zod doğrulama, scrypt parola, AES-256-GCM, TOTP 2FA, kurtarma kodları, dönen refresh jetonları, oturum yönetimi, güvenlik günlüğü, SSE canlı akış, PDF (Türkçe karakter destekli), saklama süresi, `GET /api/health`.
- Cihaz eşleştirme (6 haneli kod → cihaz jetonu), ajan uç noktaları, çevrimdışı olay kuyruğu.
- Ebeveyn paneli (React + Vite, mobil uyumlu): genel bakış, geçmiş, çocuklar/cihazlar, ayarlar, AI ayarları, güvenlik.
- İsteğe bağlı AI asistanı (kullanıcının kendi OpenAI uyumlu anahtarı); yerel güvenlik filtresi.
- Masaüstü ajanı: güvenli Electron yapılandırması, tray, tek örnek kilidi, otomatik başlatma, rıza ekranı.
- Kamera duygu analizi renderer’da (görüntü cihazdan çıkmaz), mikrofon seviyesi Web Audio ile (SoX kalktı).
- Windows NSIS kurulum paketi, Docker imajı ve `docker-compose.yml`.
- Dokümantasyon, `.env.example`, birim ve API testleri.

### Düzeltilenler
- `.env` hiç yüklenmiyordu ve token imzalama/doğrulama farklı sırlar kullanıyordu → girişten sonra tüm korumalı uç noktalar 403 veriyordu.
- Refresh sonrası rol `parent`’a dönüyordu; çocuk tüm raporları okuyup yazabiliyordu; kayıtta herkes ebeveyn olabiliyordu.
- Her origin’e açık CORS + credentials; `nodeIntegration:true`.
- Sahte veriler kaldırıldı (sabit ekran süresi, uydurma duygu dağılımı, üretimdeki test düğmeleri).
- İki süreç aynı JSON dosyalarına kilitsiz yazıyordu.

### Kaldırılanlar
- `backend/`, `frontend/`, `src/` (eski prototip), `baslat.bat`, Capacitor yapılandırması, kullanılmayan bağımlılıklar (`nedb`, `mic`, `node-mic`, `node-record-lpcm16`, `bcrypt`, `speakeasy`, …).
- Uydurma “bilgi tabanı” sohbet yanıtları ve Gemini/OpenAI’ye özel kod.

### Notlar
- Yüz modelleri `models/` yerine `apps/desktop/src/renderer/public/models/` altına taşındı.
- Parola özetleme için yerel derleme gerektirmeyen `scrypt` kullanılır (bcrypt yerine).
