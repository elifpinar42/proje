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
