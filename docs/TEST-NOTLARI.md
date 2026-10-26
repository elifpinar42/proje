# Test notları (canlı kurulum testi)

| Saat | Gözlem | Durum |
|---|---|---|
| 20:48 | Başlangıç: uygulama kurulu değil | – |
| 20:50 | Kurulum sonrası uygulama açıldı, gömülü sunucu :3737 yanıt veriyor | OK |
| 20:51 | Eşleştirme başarılı (juniorcan), rıza onaylandı | OK |
| 20:52 | Kamera izni verilmiyor (kullanıcı bildirimi) | DÜZELTİLDİ |
| 20:56 | Uygulama kapandı (sürecin kapanma nedeni belirsiz: kullanıcı mı çöktü mü) | İNCELENECEK |

## Düzeltmeler
- **Kamera/mikrofon izni:** izin denetimi `webContents` null geldiğinde reddediyordu; artık kaynak adresine (file:// / geliştirme sunucusu) bakılıyor. İzinler ilk açılışta (rıza ekranında) “İzinleri ver ve başlat” ile isteniyor; hata olursa Windows gizlilik ayarları düğmeleri çıkıyor. Kamera başka uygulamada açıksa (ör. Zoom) “Cihaz başka bir uygulama tarafından kullanılıyor” denir.
| 21:03 | Gizlilik ekranı açık ama uygulama “izin verilmedi” diyordu. Kurulu sürümle denendi: mikrofon OK, kamera `NotReadableError: Device in use` (Windows “Kamera” uygulaması kamerayı kullanıyordu). Sorun izin değil, cihaz meşgul; mesaj yanıltıcıydı | DÜZELTİLDİ |

- **Kamera/mikrofon hata mesajları** artık gerçek nedeni söylüyor (meşgul / bulunamadı / izin yok) ve ayrı ayrı gösteriliyor; meşgulse 10 sn’de bir otomatik tekrar deniyor.
| 21:10 | Sistem tepsisinde simge görünmüyor: `resources/tray.png` pakete girmiyordu (yalnızca web ve fonts kopyalanıyordu) → boş simge | DÜZELTİLDİ (2.0.1) |
| 21:10 | Windows kamera izin listesinde iki “Dijital Rehberlik” vardı: biri kurulu uygulama, diğeri benim derleme doğrulamasında çalıştırdığım `release\win-unpacked` kopyası (ayrı yol = ayrı kayıt). Hata değil | AÇIKLANDI |
