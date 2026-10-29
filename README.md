# 🛡️ Dijital Rehberlik

Çocukların dijital dünyada güvende kalmasına yardım eden, **ebeveyni bilgilendiren** ve çocuğa **rehberlik eden** bir masaüstü sistemi.

- **Çocuk bilgisayarında** çalışan masaüstü uygulaması (Electron): açık pencere başlığı, klavye hızı, (isteğe bağlı) kamera ile duygu analizi ve mikrofon ile ortam sesi seviyesini ölçer; bir **risk puanı** üretir.
- **Ebeveyn paneli** (web, telefonda da çalışır): canlı durum, geçmiş, ekran süresi, PDF rapor, izin ayarları, iki adımlı doğrulama.
- **Sunucu** (Express + SQLite): masaüstüne gömülü çalışabilir (yerel ağ dahil) ya da Docker ile bir sunucuya konabilir.
- **İsteğe bağlı AI asistanı:** Ebeveyn kendi API anahtarını (OpenAI uyumlu herhangi bir sağlayıcı) Ayarlar’dan girer. AI olmadan her şey çalışır.

> Gizlilik özeti: kamera görüntüsü ve mikrofon sesi **cihazdan çıkmaz**; yalnızca duygu etiketi ve göreli ses seviyesi gönderilir. Yazılan harfler kaydedilmez. Ayrıntı: [docs/GUVENLIK-GIZLILIK.md](docs/GUVENLIK-GIZLILIK.md).

## Hızlı başlangıç

### Kullanıcı olarak (Windows)

1. `Dijital-Rehberlik-Kurulum-x.y.z.exe` dosyasını çalıştırın (derleme: `npm run dist:win`, çıktı `release/`).
2. Uygulama ilk açılışta **“Bu bilgisayardaki yerel sunucu”** ile gelir. “Ebeveyn panelini aç”a tıklayın, hesap oluşturun, çocuk profili ekleyin ve **eşleştirme kodunu** alın.
3. Kodu masaüstü uygulamasına girin → çocuğa gösterilen açıklama ekranını onaylayın. Bitti.

Ayrıntılı kullanım: [docs/KULLANIM.md](docs/KULLANIM.md) · Sunucuya kurulum: [docs/KURULUM.md](docs/KURULUM.md)

### Geliştirici olarak

Gereksinim: **Node.js 24+** (`node:sqlite` yerleşik gelir; yerel derleme gerekmez).

```bash
npm install
npm run dev          # sunucu (3000) + web (5173) + masaüstü
npm test             # birim ve API testleri
npm run typecheck && npm run lint
npm run build        # web + sunucu + masaüstü
npm run dist:win     # Windows kurulum .exe  →  release/
npm run docker:build # sunucu Docker imajı
```

## Depo yapısı

```
apps/server    Express 5 + SQLite API; ebeveyn panelini de sunar (gömülü veya Docker)
apps/web       React + Vite ebeveyn paneli
apps/desktop   Electron ajanı (çocuk cihazı): izleme, risk motoru, kamera/mikrofon analizi
packages/shared  Ortak tipler, zod şemaları, risk motoru, sohbet güvenlik filtresi
docs/          Dokümantasyon
```

## Dokümantasyon

| Belge | İçerik |
|---|---|
| [docs/MIMARI.md](docs/MIMARI.md) | Bileşenler, veri akışı, risk formülü |
| [docs/KURULUM.md](docs/KURULUM.md) | Geliştirici, masaüstü, Docker/VPS, yerel ağ, ortam değişkenleri |
| [docs/API.md](docs/API.md) | Tüm uç noktalar |
| [docs/GUVENLIK-GIZLILIK.md](docs/GUVENLIK-GIZLILIK.md) | Tehdit modeli, veri akışı, KVKK notları |
| [docs/KULLANIM.md](docs/KULLANIM.md) | Ebeveyn ve çocuk için adım adım |
| [docs/YOL-HARITASI.md](docs/YOL-HARITASI.md) | Yapılanlar ve sonraki özellikler |
| [docs/YENIDEN-YAPILANDIRMA-PLANI.md](docs/YENIDEN-YAPILANDIRMA-PLANI.md) | Bu yeniden yapılandırmanın planı |
| [CHANGELOG.md](CHANGELOG.md) | Sürüm notları |

## Bilinen sınırlar

- Kod imzalama sertifikası yok → Windows SmartScreen uyarısı görünür.
- Global klavye kancası bazı antivirüslerde uyarı verebilir; ebeveyn panelinden “Klavye hızı” kapatılabilir.
- Çocuk, uygulamayı tepsiden kapatabilir/eşleşmeyi kaldırabilir; bu bir *rehberlik* aracıdır, kurcalamaya dayanıklı bir kısıtlama sistemi değildir.
- Kamera/mikrofon ile gerçek donanım testi otomatik yapılamaz; kontrol listesi [docs/KULLANIM.md](docs/KULLANIM.md) içindedir.
