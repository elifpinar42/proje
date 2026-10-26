# Kullanım

## Ebeveyn için

1. **Hesap oluşturun.** Panelde “Kayıt” → kullanıcı adı ve şifre (en az 8 karakter, harf + rakam). Çıkan **8 kurtarma kodunu** güvenli bir yere kaydedin; bir daha gösterilmez.
2. **Çocuk profili ekleyin** — *Çocuklar* sayfası → “Profil ekle”.
3. **Cihazı eşleştirin** — “Eşleştirme kodu üret” → 6 haneli kodu çocuğun bilgisayarındaki uygulamaya girin (10 dakika geçerli).
4. **İzinleri ayarlayın** — *Ayarlar*: pencere izleme, klavye hızı, kamera (duygu), mikrofon (ses seviyesi), bildirim, hassasiyet, saklama süresi. Çocuk cihazı yeni ayarları ~10 sn içinde alır.
5. **İzleyin** — *Genel bakış*: canlı risk puanı, duygu, açık pencere, bugünkü ekran süresi, son olaylar. *Geçmiş*: dönem, asgari risk ve kaynağa göre filtre. “Haftalık PDF raporu” ile rapor indirin.
6. **Güvenliği artırın** — *Güvenlik*: iki adımlı doğrulama, kurtarma kodlarını yenileme, açık oturumlar, güvenlik günlüğü.
7. **(İsteğe bağlı) AI asistanı** — *AI*: sağlayıcı adresi, model ve kendi API anahtarınız → “Bağlantıyı test et” → etkinleştirin. Etkinleştirince çocuk uygulamasında “Asistan” sekmesi görünür.

Şifrenizi unuttuysanız: giriş ekranında **“Şifremi unuttum”** → kullanıcı adı + bir kurtarma kodu + yeni şifre. (İki adımlı doğrulama da kapatılır.)

Telefondan kullanım: panel mobil uyumludur (yan menü bir çekmece olarak açılır). Yerel ağ adresi **Çocuklar** sayfasında görünür; bkz. [KURULUM.md](KURULUM.md).

**Eşleşmeyi kaldırma:** çocuk, kendi bilgisayarında eşleşmeyi yalnızca sizin *Çocuklar → Eşleşmeyi kaldırma kodu üret* ile verdiğiniz kodla kaldırabilir. Kod 10 dakika geçerli ve tek kullanımlıktır.

## Çocuk için

- Uygulama açılınca “Şu an neler izleniyor?” kutusunda hangi bilgilerin izlendiğini görürsün; bunları anne baban belirler.
- Kamera açıksa “Duygu durumun” çubukları görünür. Görüntü bilgisayarından çıkmaz.
- Tehlikeli bir şey olursa ekranda sakin bir **mola önerisi** çıkar.
- Asistan açıksa merak ettiklerini sorabilirsin. Şifre, adres, fotoğraf gibi konularda ya da kendini kötü hissettiğinde asistan seni bir yetişkine yönlendirir ve anne babana haber verilir.

## Manuel test kontrol listesi (gerçek donanım)

Kamera ve mikrofon otomatik test edilemez; sürüm öncesi elle doğrulayın:

- [ ] Ebeveyn panelinde Kamera izni **açık** → çocuk uygulamasında kamera ışığı yanar, “Duygu durumun” çubukları yüzünüze göre değişir.
- [ ] Kamera izni **kapatılır** → ~10 sn içinde kamera ışığı söner.
- [ ] Mikrofon izni açık → yüksek sesle konuşunca panelde “Ortam ses seviyesi” artar; kapatılınca sıfırlanır.
- [ ] Klavye hızı açık → hızlı yazınca panelde `keyboardRisk` yükselir.
- [ ] Tarayıcıda başlığında “bahis” geçen bir sekme açın → ≥ %60 risk olayı panelde görünür, çocuk ekranında mola penceresi çıkar (≥ %75).
- [ ] Sunucuyu kapatın, riskli pencere açın, sunucuyu açın → olay sonradan panele düşer (çevrimdışı kuyruk).
- [ ] Ebeveyn cihazı “Kaldır”ınca masaüstü uygulaması kurulum ekranına döner.
- [ ] Uzak (Docker) sunucuyla eşleşme ve olay gönderimi.
- [ ] Windows’ta Ayarlar → Gizlilik’ten kamera/mikrofon izni kapalıyken uygulama anlaşılır bir hata gösterir.
