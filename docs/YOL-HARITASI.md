# Yol haritası

## Tamamlanan yeniden yapılandırma (v2.0.0)

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | Dal, temizlik, `.gitignore`, veri dosyalarını takipten çıkarma | ✅ |
| 1 | npm workspaces monorepo, TypeScript, ESLint/Prettier, Vitest | ✅ |
| 2 | `apps/server`: SQLite, auth (rol korunur, refresh rotation, 2FA, kurtarma kodları), eşleştirme, ajan uç noktaları, SSE, PDF, AI ayarları, saklama süresi | ✅ |
| 3 | `apps/web`: ebeveyn paneli (mobil uyumlu) | ✅ |
| 4 | `apps/desktop`: Electron güvenli yapılandırma, izleme, risk motoru, kamera/mikrofon (renderer), olay kuyruğu, tray, otomatik başlatma | ✅ |
| 5 | electron-builder (NSIS) + Docker imajı | ✅ (Docker imajının derlenmesi bu ortamda doğrulanamadıysa [CHANGELOG](../CHANGELOG.md)’a bakın) |
| 6 | Dokümantasyon | ✅ |
| 7 | Son doğrulama | ✅ (gerçek kamera/mikrofon hariç) |

Eski prototipten düzeltilenler: `.env` yüklenmemesi ve iki farklı JWT anahtarı nedeniyle girişten sonra tüm korumalı uç noktaların 403 vermesi; bozuk `emotion.js`; çalışmayan kamera analizi (`canvas` yoktu); SoX bağımlılığı ve sabit mikrofon adı; `nodeIntegration:true`; herkese açık CORS; refresh’te rolün `parent`’a dönmesi; çocuğun tüm raporlara erişimi; kilitsiz iki süreçli JSON yazımı; sahte veriler (ekran süresi, PDF duygu dağılımı, üretimde test düğmeleri); kullanıcıya özel yola sabitlenmiş `baslat.bat`.

## Sonraki adımlar

- **Web filtresi:** tarayıcı eklentisi veya yerel vekil ile URL/kategori bazlı uyarı ve engelleme.
- **Uygulama süre limiti:** uygulama/oyun başına günlük süre kotaları ve “mola” zamanlaması.
- **Push bildirimi:** ebeveyn telefonuna (Web Push / mobil uygulama) anlık bildirim; şimdilik yalnızca açık panel (SSE).
- **Mobil uygulama:** Capacitor sarmalayıcısı ile panel (eski prototipte yapılandırması vardı, yeniden yapılandırmada kaldırıldı).
- **Ücretli sürüm — yönetilen AI:** `AiProvider` arayüzü arkasına `ManagedProvider`, kullanım sayacı ve abonelik. `ai_config.mode = 'managed'` alanı şemada hazırdır.
- **Kurcalamaya dayanıklılık:** yönetici parolası ile korunan çıkış/kaldırma, hizmet (Windows service) olarak çalışma.
- **Kod imzalama** sertifikası ve otomatik güncelleme (electron-updater).
- **macOS/Linux** masaüstü paketleri (izleme modülleri platforma göre uyarlanmalı).
- **Daha iyi duygu/ton analizi** ve sohbet filtresi için eğitimli sınıflandırıcı.
