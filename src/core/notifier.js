// src/core/notifier.js
const notifier = require('node-notifier');
const path = require('path');

let lastNotificationTime = 0;
let lastMessageKey = "";
const COOLDOWN_MS = 60000; // En az 60 saniye bildirim bekleme süresi (Spam önleme)

/**
 * Masaüstü Anlık Durum Uyarısı Gönderir
 * @param {string} title - Bildirim Başlığı
 * @param {string} message - Çocuğun Anlık Durumunu Açıklayan Detaylı Mesaj
 * @param {boolean} force - Yüksek aciliyet durumunda cooldown'ı baypas etme
 */
function sendAlert(title, message, force = false) {
    const now = Date.now();
    const messageKey = `${title}:${message}`;
    
    // Yüksek riskli ve aynı durum için 60 saniye dolmadan tekrar bildirim göndermeme (Spam Engelleme)
    if (!force && (now - lastNotificationTime < COOLDOWN_MS || messageKey === lastMessageKey)) {
        return;
    }

    lastNotificationTime = now;
    lastMessageKey = messageKey;

    try {
        notifier.notify({
            title: title || '🛡️ Dijital Rehberlik Uyarısı',
            message: message,
            sound: true,
            wait: false,
            appID: 'Dijital Güvenlik Asistanı'
        });
        console.log(`[BİLDİRİM GÖNDERİLDİ] ${title} -> ${message}`);
    } catch (e) {
        console.warn("Masaüstü bildirimi gönderilemedi:", e.message);
    }
}

module.exports = { sendAlert };


