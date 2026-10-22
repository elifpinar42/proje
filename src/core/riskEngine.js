// src/core/riskEngine.js
const { sendAlert } = require('./notifier');

/**
 * AI Destekli Risk Motoru
 * Donanım ve ortam analiz verilerini toplayıp hassas risk puanı hesaplar
 * Gerçek risk durumlarında çocuğun anlık durumunu içeren bildirimler gönderir.
 */

let currentRiskScore = 0; // 0 - 100 arası
let mainWindow = null;
let lastAlertTime = 0;
let lastGuidanceTime = 0;
const ALERT_COOLDOWN_MS = 60000; // En az 60 saniye bildirim cooldown'ı
const GUIDANCE_COOLDOWN_MS = 120000; // 2 dakika rehberlik cooldown'ı

const state = {
    emotion: 'neutral',
    emotionScore: 0,
    audioRisk: 0,
    audioDecibels: 25,
    keyboardRisk: 0,
    windowRisk: 0,
    windowTitle: ''
};

function setMainWindow(win) {
    mainWindow = win;
}

function updateState(module, data) {
    if (typeof data === 'object') {
        Object.assign(state, data);
    } else {
        state[module] = data;
    }
    calculateRisk();
}

/**
 * Gerçek Risk Analizi ve Hesaplama
 */
function calculateRisk() {
    let score = 0;
    
    // 1. Ekran ve Pencere İçerik Riski (Ağırlık: Max 50)
    if (state.windowRisk > 0) {
        score += Math.min(50, state.windowRisk * 0.6);
    }
    
    // 2. Ses ve Bağrışma Riski (Ağırlık: Max 25)
    if (state.audioRisk > 40) {
        score += Math.min(25, (state.audioRisk - 40) * 0.5);
    }
    
    // 3. Olumsuz Duygu Riski (Ağırlık: Max 25)
    if (state.emotion === 'angry') score += 25;
    else if (state.emotion === 'fearful') score += 20;
    else if (state.emotion === 'sad') score += 15;
    
    // 4. Stresli / Panik Klavye Etkileşimi (Ağırlık: Max 15)
    if (state.keyboardRisk > 50) {
        score += Math.min(15, (state.keyboardRisk - 50) * 0.3);
    }

    currentRiskScore = Math.min(100, Math.round(score));
    const now = Date.now();
    
    // Arayüze canlı durum güncellemesi gönder (Açıksa)
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try {
            mainWindow.webContents.send('update-ui', {
                emotion: state.emotion,
                audioRisk: state.audioRisk,
                audioDecibels: state.audioDecibels,
                keyboardRisk: state.keyboardRisk,
                screenRisk: state.windowRisk,
                windowTitle: state.windowTitle,
                riskScore: currentRiskScore
            });
        } catch (e) {}
    }

    // GERÇEK RİSK DURUMU KONTROLÜ (En az %60 Risk Puanı)
    if (currentRiskScore >= 60 && (now - lastAlertTime > ALERT_COOLDOWN_MS)) {
        lastAlertTime = now;
        
        // Çocuğun anlık durumunu detaylı biçimde oluşturalım
        const statusDetails = buildRealtimeChildStatus();
        const alertTitle = `⚠️ Çocuğunuzun Anlık Durum Uyarısı (%${currentRiskScore} Risk)`;

        // 1. Masaüstü Bildirimi Gönder
        sendAlert(alertTitle, statusDetails, currentRiskScore >= 80);

        // 2. Kalıcı Veritabanına ve Geçmiş Kayıtlarına İşle
        try {
            const { reportsDB } = require('../../backend/database');
            const categoryMap = {
                angry: 'Stres / Öfke Tespiti',
                fearful: 'Korku / Endişe Tespiti',
                sad: 'Üzüntü / Moral Bozukluğu',
                window: 'Sakıncalı Ekran İçeriği',
                audio: 'Yüksek Ses / Bağrışma'
            };
            let cat = 'İçerik Risk Uyarısı';
            if (state.windowRisk > 50) cat = 'Sakıncalı İçerik / Sayfa';
            else if (state.audioRisk > 60) cat = 'Yüksek Ses / Bağrışma';
            else if (state.emotion === 'angry' || state.emotion === 'fearful' || state.emotion === 'sad') cat = 'Duygu Durumu Değişimi';

            reportsDB.add({
                title: alertTitle,
                details: statusDetails,
                score: currentRiskScore,
                category: cat,
                windowTitle: state.windowTitle || 'Bilinmiyor',
                emotion: state.emotion,
                emotionLabel: `${state.emotion} (Gözlemsel Tahmin)`,
                aiObservation: `Cihaz sensörleri üzerinden alınan verilerde risk seviyesi %${currentRiskScore} olarak hesaplandı. Çocuğunuzun ruh halinde dikkat gerektiren bir değişim gözlemlendi.`,
                parentTip: `Çocuğunuzla açık ve şefkatli bir iletişim kurarak dijital deneyimleri hakkında konuşmanızı öneririz.`,
                action: 'Rehberlik Uyarısı Tetiklendi'
            });
        } catch (e) {
            console.warn("Geçmiş kaydı DB'ye işlenirken uyarı:", e.message);
        }

        // Yalnızca yüksek risk (>=75) durumunda ve 5 dakikada en fazla 1 kez bildirim/rehber uyarısı tetikle
        if (currentRiskScore >= 75 && (now - lastGuidanceTime > GUIDANCE_COOLDOWN_MS)) {
            lastGuidanceTime = now;
            
            let statusDetail = [];
            if (state.windowRisk >= 80) statusDetail.push("Ekran penceresinde hassas/sakıncalı içerik tespiti");
            if (state.audioRisk >= 50) statusDetail.push("Çevrede yüksek ses veya çığlık tespiti");
            if (state.keyboardRisk >= 50) statusDetail.push("Hızlı/aşırı klavye etkileşimi");
            if (state.emotion === 'angry' || state.emotion === 'fearful') statusDetail.push(`Çocuğun anlık duygu durumu: ${state.emotion === 'angry' ? 'Öfkeli/Stresli' : 'Korkmuş/Endişeli'}`);

            const contextMessage = statusDetail.length > 0 ? statusDetail.join(" | ") : "Çocuğun anlık dijital etkileşiminde yüksek risk tespit edildi.";

            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                mainWindow.webContents.send('show-guidance', {
                    title: 'Hassas İçerik Uyarı ve Rehberlik',
                    description: `Çocuğunuzun anlık durum analizi (%${currentRiskScore}): ${contextMessage}. Kısa bir mola vermesini yönlendirmek ister misiniz?`,
                    score: currentRiskScore
                });
            }
            
            require('./notifier').sendAlert("Dijital Rehberlik ve Durum Uyarısı", `[Anlık Durum Analizi]: ${contextMessage} (Risk: %${currentRiskScore})`);
        }
    }

}

/**
 * Çocuğun Anlık Durumunu İnsan Tarafından Anlaşılır Metne Dönüştürür
 */
function buildRealtimeChildStatus() {
    let details = [];

    // Duygu durumu
    const emoMap = {
        angry: '😠 Kızgın / Stresli',
        fearful: '😨 Korkmuş / Endişeli',
        sad: '😢 Üzgün',
        disgusted: '🤢 Tiksinmiş',
        surprised: '😲 Şaşırmış',
        happy: '😃 Mutlu',
        neutral: '😐 Nötr'
    };
    const emoText = emoMap[state.emotion] || 'Bilinmiyor';
    details.push(`Duygu: ${emoText}`);

    // Ekran / Sayfa Durumu
    if (state.windowTitle && state.windowTitle !== 'Bilinmiyor') {
        const shortTitle = state.windowTitle.length > 40 ? state.windowTitle.substring(0, 37) + '...' : state.windowTitle;
        details.push(`Açık Sayfa/Uygulama: "${shortTitle}"`);
    }

    // Ses Seviyesi
    if (state.audioRisk > 40) {
        details.push(`Ortam: Yüksek Ses / Bağrışma (${state.audioDecibels || 75} dB)`);
    }

    // Klavye Etkileşimi
    if (state.keyboardRisk > 50) {
        details.push(`Etkileşim: Hızlı / Panik Klavye Tuşlaması`);
    }

    return details.join(' | ');
}

function getRiskScore() {
    return currentRiskScore;
}

function getChildState() {
    return { ...state, currentRiskScore };
}

module.exports = { updateState, getRiskScore, setMainWindow, getChildState };



