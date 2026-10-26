# Kurulum

## 1. Masaüstü uygulaması (çocuk bilgisayarı) — Windows

1. `Dijital-Rehberlik-Kurulum-x.y.z.exe` dosyasını çalıştırın. (İmzalı olmadığı için SmartScreen “Yine de çalıştır” uyarısı verebilir.)
2. Uygulamayı açın. İlk ekranda sunucu seçilir:
   - **Bu bilgisayardaki yerel sunucu (varsayılan):** panel `http://localhost:3737` adresinde açılır.
   - **Uzak sunucu:** Docker/VPS üzerindeki sunucunun adresi (ör. `https://rehberlik.ornek.com`).
3. Ebeveyn panelinden aldığınız 6 haneli kodu girin; çocuğa gösterilen açıklamayı onaylayın.
4. Uygulama kapatılınca sistem tepsisinde çalışmaya devam eder. Otomatik başlatma çocuk uygulamasında değil, **ebeveyn panelinde** (Ayarlar → izinler) yönetilir.
5. Çocuk cihazındaki eşleşmeyi kaldırmak için ebeveyn panelinde **Çocuklar → Eşleşmeyi kaldırma kodu üret** ile alınan 6 haneli kod gerekir.

Veri klasörü: `%APPDATA%\Dijital Rehberlik\data\` (`config.json`, `queue.db`, gömülü sunucuda `server\dijital-rehberlik.db` ve `server\secrets.json`).

### Yerel ağdan (telefondan) panele erişim

Gömülü yerel sunucu **her zaman yerel ağa açıktır** (`0.0.0.0:3737`). Panelde **Çocuklar** sayfasındaki “Telefondan erişim” kartı ağ adresini (`http://192.168.x.x:3737`) gösterir; telefondan o adresi açın. Windows güvenlik duvarı izin sorarsa “Özel ağlar”a izin verin.
> Düz HTTP kullanıldığı için yalnızca güvendiğiniz ev ağında kullanın; panele giriş şifre (ve isteğe bağlı 2FA) ile korunur.

## 2. Sunucu — Docker

```bash
docker compose up -d --build
```

Panel: `http://SUNUCU:3000`. Veriler `dr-data` volume’ünde (`/data`) tutulur; JWT ve şifreleme anahtarları ilk açılışta rastgele üretilip `/data/secrets.json` içine yazılır (yedeklemeyi unutmayın; kaybolursa kayıtlı AI anahtarları çözülemez).

Docker olmadan:

```bash
npm install
npm run build -w @dr/web
npm run build -w @dr/server
DATA_DIR=./.data PORT=3000 node apps/server/dist/standalone.js   # web paneli için apps/web/dist yan dizinde bulunmalı (WEB_DIR ile de verilebilir)
```

### HTTPS (önerilir)

İnternete açıyorsanız sunucuyu Caddy/nginx gibi bir ters vekilin arkasına koyun, ortam değişkenlerini `SECURE_COOKIES=true` ve `TRUST_PROXY=true` yapın. Örnek Caddyfile:

```
rehberlik.ornek.com {
  reverse_proxy 127.0.0.1:3000
}
```

SSE (canlı akış) için vekilde yanıt tamponlaması kapalı olmalıdır (Caddy’de varsayılan; nginx’te `proxy_buffering off;`).

## 3. Ortam değişkenleri (sunucu)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Dinlenen port |
| `HOST` | `0.0.0.0` | Dinlenen adres (yerel geliştirmede `127.0.0.1` önerilir) |
| `DATA_DIR` | `./.data` (Docker: `/data`) | Veritabanı ve `secrets.json` klasörü |
| `JWT_SECRET` | otomatik üretilir | Erişim jetonu imza anahtarı |
| `ENCRYPTION_KEY` | otomatik üretilir | 64 haneli hex (32 bayt); AI anahtarı ve 2FA gizlisini şifreler |
| `ALLOWED_ORIGINS` | boş | Farklı origin’den panele izin verilecek adresler (virgülle). Panel aynı sunucudan sunuluyorsa gerekmez |
| `SECURE_COOKIES` | `false` | HTTPS arkasında `true` |
| `TRUST_PROXY` | `false` | Ters vekil arkasında `true` (doğru istemci IP’si için) |
| `ALLOW_REGISTRATION` | `true` | İlk hesabı açtıktan sonra `false` yaparak yeni kaydı kapatabilirsiniz |
| `WEB_DIR` | otomatik | Derlenmiş panel klasörü |
| `FONTS_DIR` | otomatik | PDF için DejaVu Sans yazı tipleri |

`apps/server/.env.example` dosyasına bakın. (Sunucu `.env` dosyasını kendisi okumaz; değişkenleri ortama verin: `docker compose`, systemd, `export`…)

## 4. Geliştirici ortamı

Gereksinim: Node.js 24+ (`.nvmrc`), Windows’ta masaüstü için ek olarak internet (Electron indirir).

```bash
npm install
npm run dev
```

- Sunucu: <http://127.0.0.1:3000> (`tsx watch`, veri `./.data`)
- Web: <http://localhost:5173> (Vite; `/api` isteklerini 3000’e yönlendirir)
- Masaüstü: `electron-vite dev` (gömülü sunucu `3737` portunu kullanır, geliştirme modunda **test düğmeleri** görünür)

Betikler: `dev`, `build`, `test`, `lint`, `typecheck`, `dist:win`, `docker:build`.

> Not: npm 11 yeni “allow-scripts” uyarısı verebilir. Electron ikilisi gelmediyse `node node_modules/electron/install.js` çalıştırın.

## 5. Derleme

```bash
npm run dist:win     # release/Dijital-Rehberlik-Kurulum-2.0.0.exe
npm run docker:build # dijital-rehberlik-server imajı
```
