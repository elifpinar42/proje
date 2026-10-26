# Güvenlik ve gizlilik

## Hangi veri nereye gider?

| Veri | Cihazda | Sunucuya gider mi? | Not |
|---|---|---|---|
| Kamera görüntüsü | Yalnızca bellekte işlenir | **Hayır** | Yüz analizi cihazda (face-api, WebGL); yalnızca duygu etiketi ve yüzdeler çıkar |
| Mikrofon sesi | Yalnızca bellekte işlenir | **Hayır** | Sadece göreli ses seviyesi (0–100) ölçülür, kaydedilmez |
| Basılan tuşlar | Sayılır | **Hayır** | Yalnızca “5 sn’de kaç tuş” sayısı; hangi tuş olduğu kaydedilmez |
| Açık pencerelerin başlıkları | Hepsi yerelde okunur | Yalnızca **riskli bulunan** başlık, ebeveyn “Pencere izleme”yi açtıysa | Ekran görüntüsü alınmaz |
| Ekran süresi | Hesaplanır | Evet (saniye) | Sistem boşta süresi < 60 sn ise “aktif” sayılır |
| Risk puanı, duygu etiketi | Hesaplanır | Evet | Her 10 sn’de nabız; eşik aşılınca olay |
| Sohbet mesajları | — | Evet; AI açıksa **ebeveynin seçtiği AI sağlayıcısına** da | Önce yerel güvenlik filtresi; tehlike varsa AI’a gitmez |

Çocuk, eşleşme sırasında hangi sinyallerin açık olduğunu gösteren bir **açıklama/rıza ekranı** görür ve ana ekranda “Şu an neler izleniyor?” listesini her zaman görebilir.

## Tehdit modeli

| Tehdit | Önlem |
|---|---|
| Başka ebeveynin/çocuğun verisine erişim (IDOR) | Her uç nokta `child → parent_id` sahipliğini doğrular, aksi `404`; testle doğrulanır |
| Çocuğun ebeveyn verisine/ayarlarına erişimi | Çocuk hesabı yoktur; cihaz jetonu yalnızca `/api/agent/*` uç noktalarına izin verir |
| Parola saldırıları | scrypt (N=16384) ile özetleme; kimlik uç noktalarında hız sınırı; zamanlama eşitleme; başarısız girişler güvenlik günlüğüne yazılır |
| Oturum çalınması | 15 dk erişim jetonu bellekte; 7 gün yenileme jetonu HttpOnly + SameSite=Lax çerezde, **döner**; kullanılmış jeton tekrar gelirse tüm oturumlar kapatılır; oturumlar panelden görülüp sonlandırılabilir |
| Hesap ele geçirme | İsteğe bağlı TOTP 2FA; kurtarma kodları yalnızca SHA-256 özeti olarak saklanır, tek kullanımlıktır |
| Gizli anahtarların sızması | Sabit varsayılan anahtar yok: JWT/şifreleme anahtarları ilk açılışta rastgele üretilir (`secrets.json`, mod 0600) veya env ile verilir |
| AI anahtarının sızması | AES-256-GCM ile şifreli saklanır, hiçbir API yanıtında dönmez, çağrılar yalnızca sunucudan yapılır |
| XSS | Panel ve çocuk arayüzü React (kaçışlı); `innerHTML` yok; sıkı CSP (`script-src 'self'`) |
| Electron’dan sistem erişimi | `contextIsolation`, `nodeIntegration:false`, `sandbox:true`; dar `contextBridge` API’si; IPC gönderen doğrulaması; yalnızca kendi arayüzüne kamera/mikrofon izni; pencere açma/gezinme engellenir |
| CORS | Varsayılan olarak aynı origin; yalnızca `ALLOWED_ORIGINS` listesindeki origin’lere izin |
| Çocuğun eşleşmeyi kaldırması | Cihaz tarafında kaldırma, ebeveynin ürettiği tek kullanımlık 6 haneli kodu gerektirir (sunucuda doğrulanır) |
| Ağdaki dinleme | Yerel ağda düz HTTP kullanılırsa trafik şifresizdir → internete HTTPS ile açın |
| Eşleştirme kodunu tahmin | 6 hane, 10 dk, tek kullanımlık, `/agent/pair` için 15 dk’da 10 deneme sınırı |

### Kapsam dışı / bilinen sınırlar

- Çocuk, yönetici haklarıyla uygulamayı kapatabilir veya eşleşmeyi kaldırabilir (kurcalamaya dayanıklılık hedeflenmemiştir). Ebeveyn, cihazın uzun süre nabız göndermemesini panelde “Çevrimdışı” olarak görür.
- Yerel gömülü sunucuda veritabanı diskte şifresiz saklanır (yalnızca AI anahtarı ve 2FA gizlisi alan düzeyinde şifrelidir). Disk şifrelemesi (BitLocker) önerilir.
- AI sağlayıcı adresi ebeveyn tarafından girilir; sunucu, o adrese istek gönderir (Ollama gibi yerel sağlayıcılar için bilinçli olarak serbesttir). Sunucuyu çok kullanıcılı/halka açık çalıştırıyorsanız `ALLOW_REGISTRATION=false` yapın.

## KVKK notları

Bu yazılım, çocukların kişisel verilerini işler. Kurulumu yapan ebeveyn/veli **veri sorumlusu**dur. Öneriler:

- Çocuğa yaşına uygun şekilde izlemeyi açıklayın (uygulama bunu rıza ekranıyla destekler); reşit olan bireyleri izlemeyin.
- **Veri minimizasyonu:** ham kamera/ses/tuş verisi saklanmaz; yalnızca ebeveynin açtığı sinyaller işlenir.
- **Saklama süresi:** Ayarlar’dan çocuk başına 1–3650 gün; süresi dolan olay/nabız/sohbet kayıtları otomatik silinir (açılışta ve 6 saatte bir).
- **Silme hakkı:** “Tüm verileri sil” ve “Profili sil” düğmeleri ilgili tüm kayıtları kalıcı siler.
- **Aktarım:** AI özelliğini açarsanız, çocuğun sohbet mesajları seçtiğiniz sağlayıcıya gider; sağlayıcının gizlilik koşullarını inceleyin. AI kapalıyken hiçbir veri üçüncü tarafa gitmez.
- Bu belge hukuki danışmanlık değildir.

## AI anahtarı yönetimi

1. Ebeveyn **AI** sayfasında taban adres, model ve anahtarı girer (OpenAI uyumlu `/chat/completions`).
2. Anahtar `ENCRYPTION_KEY` ile AES-256-GCM şifrelenerek `ai_config` tablosuna yazılır.
3. Sayfa anahtarı geri göstermez (`hasKey: true`); boş bırakıp kaydetmek mevcut anahtarı korur; “Anahtarı sil” ile kaldırılır.
4. `ENCRYPTION_KEY` kaybolursa kayıtlı anahtar çözülemez — yeniden girilmelidir.
