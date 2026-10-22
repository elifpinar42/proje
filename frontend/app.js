// frontend/app.js - AI Destekli Dijital İçerik Rehberlik ve Güvenlik Sistemi (7 Duygu Tam Analiz Motoru)

const API_BASE = (window.location && window.location.origin && window.location.origin.startsWith('http')) 
    ? `${window.location.origin}/api` 
    : 'http://localhost:3000/api';

// Uygulama Durumu
let currentUser = null;
let currentSettings = {
    sensitivity: 'medium',
    cameraEnabled: false,
    micEnabled: false,
    screenEnabled: true,
    keyboardEnabled: true,
    notifyParentOnRisk: true
};

let webcamStream = null;
let audioContext = null;
let audioAnalyser = null;
let audioStream = null;
let recommendationsList = [];
let guidanceActive = false;
let liveAnalyticsLoopStarted = false;

// ============================================================
// BİLDİRİM COOLDOWN / THROTTLE SİSTEMİ
// Aynı uyarı tipi için minimum bekleme süreleri (ms)
// ============================================================
const NOTIFICATION_COOLDOWNS = {
    'keyboard':    60000,  // Klavye stresi → 60 saniye
    'audio':       45000,  // Ses uyarısı   → 45 saniye
    'screen':      90000,  // Ekran içeriği → 90 saniye
    'ipc':         30000,  // Electron IPC  → 30 saniye
    'default':     60000   // Diğerleri     → 60 saniye
};
// Son bildirim zamanları
const _notifLastShown = {};
// Kapatıldıktan sonra ne kadar süre yeniden açılamasın (ms)
const REOPEN_BLOCK_MS = 5000;
let _guidanceClosedAt = 0;

/**
 * Bildirim gösterilebilir mi? Cooldown kontrolü yapar.
 * @param {string} type - Bildirim tipi (keyboard|audio|screen|ipc|default)
 * @returns {boolean}
 */
function canShowNotification(type) {
    const cooldown = NOTIFICATION_COOLDOWNS[type] || NOTIFICATION_COOLDOWNS['default'];
    const lastShown = _notifLastShown[type] || 0;
    const now = Date.now();
    // Yeni kapatıldıysa engelle
    if (now - _guidanceClosedAt < REOPEN_BLOCK_MS) return false;
    return (now - lastShown) >= cooldown;
}

/**
 * Bildirim gösterildi olarak işaretle.
 * @param {string} type
 */
function markNotificationShown(type) {
    _notifLastShown[type] = Date.now();
}

// ============================================================
// TOAST / BANNER BİLDİRİM SİSTEMİ (INFO / WARNING için)
// ============================================================
let _toastTimeout = null;

function showToastNotification(message, severity) {
    // Önceki toast varsa kaldır
    const existing = document.getElementById('guidance-toast');
    if (existing) existing.remove();
    if (_toastTimeout) clearTimeout(_toastTimeout);

    const bgColor = severity === 'warning' ? 'rgba(245,158,11,0.95)' : 'rgba(99,102,241,0.95)';
    const icon    = severity === 'warning' ? '⚠️' : 'ℹ️';

    const toast = document.createElement('div');
    toast.id = 'guidance-toast';
    toast.style.cssText = [
        'position:fixed',
        'top:16px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:10000',
        `background:${bgColor}`,
        'color:#fff',
        'padding:10px 18px',
        'border-radius:12px',
        'font-size:0.85rem',
        'max-width:90vw',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
        'animation:fadeIn 0.3s ease',
        'pointer-events:auto'
    ].join(';');

    toast.innerHTML = `
        <span>${icon}</span>
        <span style="flex:1">${message}</span>
        <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer;padding:0 4px;">✕</button>
    `;
    document.body.appendChild(toast);

    // Otomatik kapat (10 saniye)
    _toastTimeout = setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 10000);
}

// Klavye Etkileşim Takibi
let keypressHistory = [];
let typingSpeedKPM = 0;

// Canlı Duygu ve Analiz Yüzdeleri (TÜM 7 TEMEL DUYGU)
let liveAnalyticsData = {
    neutral: 0,
    happy: 0,
    sad: 0,
    angry: 0,
    fearful: 0,
    disgusted: 0,
    surprised: 0,
    decibels: 25,
    screenSafety: 98,
    keyboardStress: 12,
    overallHealth: 95,
    faceDetected: false
};

// Sayfa Yüklendiğinde
document.addEventListener('DOMContentLoaded', () => {
    checkAuthSession();
    fetchRecommendations();
    setupKeyboardTracker();
    setupScreenTracker();
    setupElectronIPC();
});

// Electron IPC Bağlantısı
function setupElectronIPC() {
    try {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('update-ui', (event, data) => {
                if (!data) return;
                
                // Ses desibelini ve görselini güncelle
                if (data.audioDecibels !== undefined) {
                    liveAnalyticsData.decibels = data.audioDecibels;
                    drawAudioDecibelLevel(data.audioDecibels);
                    
                    const label = document.getElementById('mic-status-label');
                    if (label) {
                        let statusText = 'Sessiz';
                        let color = 'var(--secondary)';
                        if (data.audioDecibels > 75) {
                            statusText = '⚠️ Yüksek Ses / Bağrışma';
                            color = 'var(--danger)';
                        } else if (data.audioDecibels > 45) {
                            statusText = 'Konuşma';
                            color = 'var(--info)';
                        }
                        label.textContent = `${statusText} (${data.audioDecibels} dB)`;
                        label.style.color = color;
                    }
                }

                // Klavye stresini güncelle
                if (data.keyboardRisk !== undefined) {
                    liveAnalyticsData.keyboardStress = Math.max(liveAnalyticsData.keyboardStress, data.keyboardRisk);
                }

                // Ekran güvenliğini güncelle
                if (data.screenRisk !== undefined) {
                    liveAnalyticsData.screenSafety = Math.max(0, 100 - data.screenRisk);
                }

                updateEmotionUI();
            });

            // Gerçek yüz/duygu analiz sonuçlarını al
            ipcRenderer.on('emotion-result', (event, result) => {
                if (!result) return;

                if (!result.faceDetected) {
                    liveAnalyticsData.faceDetected = false;
                    updateEmotionUI();
                    return;
                }

                // Gerçek 7 duygu yüzdelerini uygula
                liveAnalyticsData.faceDetected = true;
                const exp = result.expressions || {};
                liveAnalyticsData.neutral    = exp.neutral    || 0;
                liveAnalyticsData.happy      = exp.happy      || 0;
                liveAnalyticsData.sad        = exp.sad        || 0;
                liveAnalyticsData.angry      = exp.angry      || 0;
                liveAnalyticsData.fearful    = exp.fearful    || 0;
                liveAnalyticsData.disgusted  = exp.disgusted  || 0;
                liveAnalyticsData.surprised  = exp.surprised  || 0;

                updateEmotionUI();
            });

            ipcRenderer.on('show-guidance', (event, guidanceData) => {
                // IPC kaynaklı uyarılar: cooldown kontrolü ile CRITICAL modal
                if (canShowNotification('ipc')) {
                    markNotificationShown('ipc');
                    triggerGuidanceModal({
                        title:       guidanceData.title || 'Hassas İçerik Uyarısı',
                        description: guidanceData.description || 'Hassas veya olumsuz unsurlar tespit edildi.',
                        score:       guidanceData.score || 75,
                        severity:    'critical',
                        notifType:   'ipc'
                    });
                }
            });
        }
    } catch (e) {}
}



// Ekran Değiştirme Yardımcısı
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) targetScreen.classList.remove('hidden');
}

// REST API Çağrısı (Credentials & Auto Token Refresh Interceptor)
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('accessToken') || localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const config = { 
        method, 
        headers,
        credentials: 'include' // Cookie tabanlı refresh token iletimi için
    };
    if (body) config.body = JSON.stringify(body);

    try {
        let res = await fetch(`${API_BASE}${endpoint}`, config);
        
        // Access Token Süresi Dolmuşsa (401) Otomatik Refresh Token ile Yenileme Denemesi
        if (res.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
            try {
                const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                });
                if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    localStorage.setItem('accessToken', refreshData.accessToken);
                    headers['Authorization'] = `Bearer ${refreshData.accessToken}`;
                    // İsteği yeni token ile tekrar et
                    res = await fetch(`${API_BASE}${endpoint}`, { ...config, headers });
                } else {
                    handleLogout();
                    throw new Error("Oturum süresi doldu, lütfen tekrar giriş yapın.");
                }
            } catch (e) {
                handleLogout();
                throw new Error("Oturum süresi doldu.");
            }
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Bir hata oluştu');
        return data;
    } catch (err) {
        console.error(`API Error (${endpoint}):`, err);
        throw err;
    }
}

// Oturum Kontrolü
function checkAuthSession() {
    const savedUser = localStorage.getItem('user');
    const token = localStorage.getItem('accessToken') || localStorage.getItem('token');

    if (savedUser && token) {
        currentUser = JSON.parse(savedUser);
        updateUserUI();
    } else {
        showScreen('screen-login');
        document.getElementById('app-nav-bar').classList.add('hidden');
        document.getElementById('user-role-badge').classList.add('hidden');
    }
}

// Kullanıcı Arayüzü Güncelleme
function updateUserUI() {
    document.getElementById('app-nav-bar').classList.remove('hidden');
    const badge = document.getElementById('user-role-badge');
    badge.classList.remove('hidden');

    const nameEl = document.getElementById('live-user-name');
    if (nameEl && currentUser) {
        nameEl.textContent = `${currentUser.username} (${currentUser.type === 'parent' ? 'Ebeveyn' : 'Çocuk Modu'})`;
    }

    if (currentUser.type === 'parent') {
        badge.textContent = 'Ebeveyn Paneli';
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#fca5a5';
        badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        switchTab('parent');
    } else {
        badge.textContent = 'Çocuk Modu';
        badge.style.background = 'rgba(99, 102, 241, 0.2)';
        badge.style.color = '#a5b4fc';
        badge.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        switchTab('home');
    }

    loadSettings();
    startLiveAnalyticsLoop();
}

// Sekme Değiştirme
function switchTab(tab) {
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

    if (tab === 'home') {
        document.getElementById('nav-btn-home').classList.add('active');
        showScreen('screen-child-dashboard');
    } else if (tab === 'parent') {
        document.getElementById('nav-btn-parent').classList.add('active');
        showScreen('screen-parent-dashboard');
        setHistoryFilter('today');
    }
}

// AUTH İŞLEMLERİ & 2FA İSTEMCİSİ
async function handleLogin() {
    const uInput = document.getElementById('login-username').value.trim();
    const pInput = document.getElementById('login-password').value.trim();
    const twoFactorInput = document.getElementById('login-2fa-code') ? document.getElementById('login-2fa-code').value.trim() : null;

    if (!uInput || !pInput) {
        alert('Lütfen kullanıcı adı ve şifrenizi girin.');
        return;
    }

    try {
        const payload = { username: uInput, password: pInput };
        if (twoFactorInput) payload.twoFactorCode = twoFactorInput;

        const data = await apiRequest('/auth/login', 'POST', payload);

        // Eğer 2FA kodu isteniyorsa 2FA giriş alanını göster
        if (data.require2FA) {
            const container = document.getElementById('2fa-input-container');
            if (container) container.classList.remove('hidden');
            alert(data.message);
            return;
        }

        localStorage.setItem('accessToken', data.accessToken || data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        currentUser = data.user;
        updateUserUI();
    } catch (err) {
        alert(err.message);
    }
}

async function handleLogout() {
    // Donanım akışlarını durdur
    stopWebcam();
    await stopAudioAnalyser();

    // Guidance modal açıksa kapat
    const modal = document.getElementById('guidance-modal');
    if (modal) modal.classList.add('hidden');
    guidanceActive = false;

    // Bildirimleri temizle
    const toast = document.getElementById('guidance-toast');
    if (toast) toast.remove();

    // Backend'e logout bildir (hata olsa da devam et)
    try {
        await apiRequest('/auth/logout', 'POST');
    } catch (e) {}

    // Tüm auth state'i temizle
    localStorage.removeItem('accessToken');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;

    // Cooldown state sıfırla
    Object.keys(_notifLastShown).forEach(k => delete _notifLastShown[k]);
    liveAnalyticsLoopStarted = false;

    // Login ekranına geç
    showScreen('screen-login');
    document.getElementById('app-nav-bar').classList.add('hidden');
    document.getElementById('user-role-badge').classList.add('hidden');
}

async function handleRegister() {
    const type = document.getElementById('reg-type').value;
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const securityQuestion = document.getElementById('reg-question').value.trim();
    const securityAnswer = document.getElementById('reg-answer').value.trim();

    if (!username || !password || !securityQuestion || !securityAnswer) {
        alert('Lütfen tüm alanları doldurun.');
        return;
    }

    try {
        await apiRequest('/auth/register', 'POST', {
            type, username, password, securityQuestion, securityAnswer
        });
        alert('Kayıt başarılı! Şimdi giriş yapabilirsiniz.');
        showScreen('screen-login');
    } catch (err) {
        alert(err.message);
    }
}

async function handleResetPassword() {
    const username = document.getElementById('reset-username').value.trim();
    const securityQuestion = document.getElementById('reset-question').value.trim();
    const securityAnswer = document.getElementById('reset-answer').value.trim();
    const newPassword = document.getElementById('reset-newpassword').value.trim();

    if (!username || !securityQuestion || !securityAnswer || !newPassword) {
        alert('Lütfen tüm alanları doldurun.');
        return;
    }

    try {
        await apiRequest('/auth/reset-password', 'POST', {
            username, securityQuestion, securityAnswer, newPassword
        });
        alert('Şifreniz başarıyla güncellendi.');
        showScreen('screen-login');
    } catch (err) {
        alert(err.message);
    }
}

// NOT: handleLogout yukarıda tek bir async fonksiyon olarak tanımlandı.
// Bu eski/duplike tanım kaldırıldı — çift tanım login ekranını kilitliyordu.

// EBEVEYN AYARLARI VE DONANIM İZİNLERİ
async function loadSettings() {
    try {
        const settings = await apiRequest('/settings');
        if (settings) {
            currentSettings = { ...currentSettings, ...settings };
        }

        const sensEl = document.getElementById('parent-sensitivity');
        const camEl = document.getElementById('toggle-camera');
        const micEl = document.getElementById('toggle-mic');
        const screenEl = document.getElementById('toggle-screen');
        const keyEl = document.getElementById('toggle-keyboard');

        if (sensEl && currentSettings.sensitivity) sensEl.value = currentSettings.sensitivity;
        if (camEl) camEl.checked = !!currentSettings.cameraEnabled;
        if (micEl) micEl.checked = !!currentSettings.micEnabled;
        if (screenEl) screenEl.checked = !!currentSettings.screenEnabled;
        if (keyEl) keyEl.checked = !!currentSettings.keyboardEnabled;

        // A persisted setting alone must not start a microphone on app launch.
        applyHardwarePermissions({ syncMicrophone: false });
    } catch (err) {
        console.warn('Ayarlar yüklenemedi (varsayılanlar kullanılacak):', err.message);
    }
}

async function saveParentSettings() {
    const updated = {
        sensitivity: document.getElementById('parent-sensitivity') ? document.getElementById('parent-sensitivity').value : (currentSettings.sensitivity || 'medium'),
        cameraEnabled: document.getElementById('toggle-camera') ? document.getElementById('toggle-camera').checked : !!currentSettings.cameraEnabled,
        micEnabled: document.getElementById('toggle-mic') ? document.getElementById('toggle-mic').checked : !!currentSettings.micEnabled,
        screenEnabled: document.getElementById('toggle-screen') ? document.getElementById('toggle-screen').checked : !!currentSettings.screenEnabled,
        keyboardEnabled: document.getElementById('toggle-keyboard') ? document.getElementById('toggle-keyboard').checked : !!currentSettings.keyboardEnabled
    };

    currentSettings = { ...currentSettings, ...updated };

    try {
        const res = await apiRequest('/settings', 'POST', updated);
        if (res && res.settings) {
            currentSettings = { ...currentSettings, ...res.settings };
        }
    } catch (err) {
        console.warn('Ayarlar sunucuya kaydedilemedi (yerel olarak uygulandı):', err.message);
    }

    try {
        // Only an explicit parent save can change main-process microphone state.
        await applyHardwarePermissions({ syncMicrophone: true });
    } catch (permErr) {
        console.warn('Donanım izinleri uygulanırken uyarı:', permErr);
    }
}

async function applyHardwarePermissions({ syncMicrophone = false } = {}) {
    if (currentSettings.cameraEnabled) {
        startWebcam();
    } else {
        stopWebcam();
    }

    if (syncMicrophone) {
        if (currentSettings.micEnabled) {
            await startAudioAnalyser();
        } else {
            await stopAudioAnalyser();
        }
    }
}

// 1. GERÇEK KAMERA VE 7 DUYGU GÖRSEL KARE ANALİZÖRÜ (Ultra Hafif & Mobil Uyumlu)
let canvasFaceInterval = null;

async function startWebcam() {
    if (webcamStream) return;

    const videoEl = document.getElementById('camera-video');
    const indicator = document.getElementById('cam-live-indicator');
    const placeholder = document.getElementById('cam-placeholder-text');

    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 480 }, 
                height: { ideal: 360 },
                facingMode: "user"
            }, 
            audio: false 
        });
        if (videoEl) {
            videoEl.srcObject = webcamStream;
            try {
                await videoEl.play();
            } catch (playErr) {
                console.warn('Video play uyarısı:', playErr);
            }
        }
        if (indicator) indicator.classList.remove('hidden');
        if (placeholder) placeholder.classList.add('hidden');

        startCanvasFaceAnalyzer();
    } catch (err) {
        console.warn('Kamera erişimi sağlanamadı:', err.message);
        if (placeholder) {
            placeholder.classList.remove('hidden');
            placeholder.textContent = '⚠️ Kamera erişimine izin verilmedi veya donanım bulunamadı.';
        }
    }
}

function stopWebcam() {
    if (canvasFaceInterval) {
        clearInterval(canvasFaceInterval);
        canvasFaceInterval = null;
    }
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        webcamStream = null;
    }
    const videoEl = document.getElementById('camera-video');
    const indicator = document.getElementById('cam-live-indicator');
    const placeholder = document.getElementById('cam-placeholder-text');

    if (videoEl) videoEl.srcObject = null;
    if (indicator) indicator.classList.add('hidden');
    if (placeholder) {
        placeholder.classList.remove('hidden');
        placeholder.textContent = '📷 Kamera kapalı. Başlatmak için ebeveyn panelinden veya butondan kameraya izin verin.';
    }
    liveAnalyticsData.faceDetected = false;
    updateEmotionUI();
}

function toggleWebcamFeed() {
    if (webcamStream) {
        stopWebcam();
        currentSettings.cameraEnabled = false;
    } else {
        startWebcam();
        currentSettings.cameraEnabled = true;
    }
    const toggleCam = document.getElementById('toggle-camera');
    if (toggleCam) {
        toggleCam.checked = !!webcamStream;
    }
    if (currentUser && currentUser.type === 'parent') {
        saveParentSettings().catch(() => {});
    }
}

// 7 DUYGU İFADELERİNİ CANLI OLARAK DEĞİŞTİRİP TEST ETMENİZİ SAĞLAYAN METOT
function setTestEmotion(emoKey) {
    liveAnalyticsData.faceDetected = true;
    const keys = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
    keys.forEach(k => liveAnalyticsData[k] = 3);

    if (emoKey === 'happy') { liveAnalyticsData.happy = 68; liveAnalyticsData.neutral = 18; }
    else if (emoKey === 'angry') { liveAnalyticsData.angry = 72; liveAnalyticsData.neutral = 14; }
    else if (emoKey === 'sad') { liveAnalyticsData.sad = 65; liveAnalyticsData.neutral = 20; }
    else if (emoKey === 'fearful') { liveAnalyticsData.fearful = 70; liveAnalyticsData.neutral = 15; }
    else if (emoKey === 'disgusted') { liveAnalyticsData.disgusted = 66; liveAnalyticsData.neutral = 19; }
    else if (emoKey === 'surprised') { liveAnalyticsData.surprised = 74; liveAnalyticsData.neutral = 12; }
    else { liveAnalyticsData.neutral = 72; liveAnalyticsData.happy = 14; }

    updateEmotionUI();
}

function startCanvasFaceAnalyzer() {
    if (canvasFaceInterval) clearInterval(canvasFaceInterval);
    const videoEl = document.getElementById('camera-video');
    const offscreenCanvas = document.createElement('canvas');
    const ctx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    offscreenCanvas.width = 160;
    offscreenCanvas.height = 120;

    let ipcRenderer = null;
    try {
        if (window.require) ipcRenderer = window.require('electron').ipcRenderer;
    } catch (e) {}

    let isProcessing = false;

    // Her 1.2 saniyede bir hafif yüz & duygu analizi (RAM ve CPU dostu)
    canvasFaceInterval = setInterval(() => {
        if (!webcamStream) {
            clearInterval(canvasFaceInterval);
            canvasFaceInterval = null;
            return;
        }
        if (!videoEl || videoEl.paused || videoEl.ended || videoEl.videoWidth === 0) return;
        if (isProcessing) return;

        try {
            isProcessing = true;
            ctx.drawImage(videoEl, 0, 0, 160, 120);

            // İstemci tarafında hafif yüz/parlaklık varlığı kontrolü
            const imgData = ctx.getImageData(0, 0, 160, 120);
            const data = imgData.data;
            let brightnessSum = 0;
            let edgeDiff = 0;
            
            // Hızlı piksel örneklemesi
            for (let i = 0; i < data.length; i += 16) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                const brightness = (r + g + b) / 3;
                brightnessSum += brightness;
                if (i > 16) {
                    edgeDiff += Math.abs(brightness - ((data[i-16] + data[i-15] + data[i-14]) / 3));
                }
            }

            const avgBrightness = brightnessSum / (data.length / 16);
            const avgDiff = edgeDiff / (data.length / 16);

            // Yüz ve ortam algılama (kamera önünde biri var mı?)
            if (avgBrightness > 20 && avgDiff > 5) {
                liveAnalyticsData.faceDetected = true;
                // DÜZELTME: Sabit değer atama kaldırıldı.
                // Gerçek duygu değerleri yalnızca 'emotion-result' IPC olayıyla
                // (camera.js → ana süreç → renderer) veya setTestEmotion() ile gelir.
                // Burada sahte değer atamak gerçek model çıktısını gizliyordu.
            } else {
                liveAnalyticsData.faceDetected = false;
            }

            updateEmotionUI();

            // Electron ortamı varsa ve IPC hazırsa arka plana da bildir
            if (ipcRenderer) {
                const dataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.6);
                ipcRenderer.send('frame-data', dataUrl);
            }
            
            setTimeout(() => { isProcessing = false; }, 600);
        } catch (e) {
            isProcessing = false;
        }
    }, 1200);
}


// 2. GERÇEK MİKROFON SES DESİBEL VE FREKANS SPEKTRUMU ANALİZİ (WEB AUDIO API & MOBİL UYUMLU)
async function setMainProcessMicrophoneEnabled(enabled) {
    try {
        if (!window.require) return { ok: false, active: false };
        const { ipcRenderer } = window.require('electron');
        return await ipcRenderer.invoke('audio-monitoring:set-enabled', enabled);
    } catch (err) {
        return { ok: false, active: false };
    }
}

async function startAudioAnalyser() {
    // Önce masaüstü IPC varsa bildir
    setMainProcessMicrophoneEnabled(true).catch(() => {});

    if (audioContext && audioStream) return;

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(audioStream);
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 64; // Ultra hafif FFT boyutu (Düşük RAM)
        audioAnalyser.smoothingTimeConstant = 0.8;
        source.connect(audioAnalyser);

        drawAudioSpectrum();
        
        const label = document.getElementById('mic-status-label');
        if (label) {
            label.textContent = 'Canlı Dinleniyor';
            label.style.color = 'var(--secondary)';
        }
    } catch (err) {
        console.warn('Mikrofon erişimi sağlanamadı:', err.message);
        const label = document.getElementById('mic-status-label');
        if (label) {
            label.textContent = 'İzin Gerekli';
            label.style.color = 'var(--warning)';
        }
    }
}

async function stopAudioAnalyser() {
    await setMainProcessMicrophoneEnabled(false).catch(() => {});
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    if (audioContext) {
        try { await audioContext.close(); } catch (e) {}
        audioContext = null;
    }
    audioAnalyser = null;
    const label = document.getElementById('mic-status-label');
    if (label) {
        label.textContent = 'Kapalı (Etik)';
        label.style.color = 'var(--text-muted)';
    }
    liveAnalyticsData.decibels = 20;
    updateEmotionUI();
}

function drawAudioSpectrum() {
    const canvas = document.getElementById('audio-visualizer');
    if (!canvas || !audioAnalyser) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
        if (!audioAnalyser) return;
        requestAnimationFrame(renderFrame);

        audioAnalyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let sumSquare = 0;
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const val = dataArray[i];
            sumSquare += val * val;
            const barHeight = (val / 255) * canvas.height;

            const hue = 220 + (val / 255) * 100;
            ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.85)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

            x += barWidth;
        }

        const rms = Math.sqrt(sumSquare / bufferLength);
        const decibels = Math.min(100, Math.max(18, Math.round(20 + (rms / 255) * 75)));
        liveAnalyticsData.decibels = decibels;

        const label = document.getElementById('mic-status-label');
        if (label) {
            let statusText = 'Sessiz';
            let color = 'var(--secondary)';

            if (decibels > 75) {
                statusText = '⚠️ Yüksek Ses Algılandı';
                color = 'var(--danger)';
            } else if (decibels > 45) {
                statusText = 'Normal Konuşma';
                color = 'var(--info)';
            }

            label.textContent = `${statusText} (${decibels} dB)`;
            label.style.color = color;
        }
    }

    renderFrame();
}

function drawAudioDecibelLevel(dB) {
    const canvas = document.getElementById('audio-visualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bars = 24;
    const barWidth = Math.floor(canvas.width / bars) - 2;
    const normalized = Math.min(1, Math.max(0.08, (dB - 15) / 65));

    for (let i = 0; i < bars; i++) {
        const factor = Math.sin((i / bars) * Math.PI);
        const barHeight = Math.max(3, canvas.height * normalized * factor * (0.6 + Math.random() * 0.4));
        const hue = 200 + normalized * 130;
        ctx.fillStyle = `hsla(${hue}, 85%, 60%, 0.85)`;
        const x = i * (barWidth + 2);
        const y = (canvas.height - barHeight) / 2;
        ctx.fillRect(x, y, barWidth, barHeight);
    }
}

// 3. KLAVYE ETKİLEŞİM VE PANİK TAKİBİ
function setupKeyboardTracker() {
    document.addEventListener('keydown', () => {
        if (!currentSettings.keyboardEnabled) return;
        const now = Date.now();
        keypressHistory.push(now);
        keypressHistory = keypressHistory.filter(t => now - t < 5000);
        
        typingSpeedKPM = keypressHistory.length * 12;
        let stress = Math.min(100, Math.round((keypressHistory.length / 20) * 100));
        liveAnalyticsData.keyboardStress = Math.max(stress, 8);
        updateEmotionUI();
    });

    // Tuş basımı durduğunda stresi yavaşça normale çek
    setInterval(() => {
        if (!currentSettings.keyboardEnabled) return;
        const now = Date.now();
        const prevCount = keypressHistory.length;
        keypressHistory = keypressHistory.filter(t => now - t < 5000);
        if (keypressHistory.length !== prevCount) {
            let stress = Math.min(100, Math.round((keypressHistory.length / 20) * 100));
            liveAnalyticsData.keyboardStress = stress;
            updateEmotionUI();
        }
    }, 1000);
}

// 4. EKRAN VE METİN İÇERİK TARAYICI
function setupScreenTracker() {
    // Harici içerik anahtar kelimeleri (Uygulamanın kendi yardım butonları taranmaz)
    const highRiskKeywords = ['kumar', 'bahis', 'casino', 'porno', 'canlı bahis', 'silah satın al'];

    setInterval(() => {
        if (!currentSettings.screenEnabled) return;
        // Kullanıcı giriş yapmamışsa veya ebeveyn panelindeyse uyarı verme
        if (!currentUser || currentUser.type === 'parent') return;

        // Yalnızca gelen sohbet yanıtlarında harici sakıncalı içerik varsa kontrol et
        const chatThread = document.getElementById('child-ai-chat-thread');
        const userText = chatThread ? chatThread.innerText.toLowerCase() : '';
        
        let foundBadWord = false;
        highRiskKeywords.forEach(kw => {
            if (userText.includes(kw)) foundBadWord = true;
        });

        if (foundBadWord) {
            liveAnalyticsData.screenSafety = 35;
            if (canShowNotification('screen')) {
                markNotificationShown('screen');
                triggerGuidanceModal({
                    title: 'Sakıncalı İçerik Uyarısı',
                    description: 'Görüntülenen içerikte hassas veya yaşa uygun olmayan unsurlar tespit edildi.',
                    score: 80,
                    notifType: 'screen'
                });
            }
        } else {
            liveAnalyticsData.screenSafety = 98;
        }
    }, 10000);
}

// 📊 TÜM 7 DUYGU GÖRSEL ARAYÜZ GÜNCELLEMESİ
function updateEmotionUI() {
    const updateEmo = (key, val) => {
        const valEl = document.getElementById(`emo-val-${key}`);
        const barEl = document.getElementById(`emo-bar-${key}`);
        if (valEl) valEl.textContent = `%${val}`;
        if (barEl) barEl.style.width = `${val}%`;
    };

    updateEmo('neutral', liveAnalyticsData.neutral);
    updateEmo('happy', liveAnalyticsData.happy);
    updateEmo('sad', liveAnalyticsData.sad);
    updateEmo('angry', liveAnalyticsData.angry);
    updateEmo('fearful', liveAnalyticsData.fearful);
    updateEmo('disgusted', liveAnalyticsData.disgusted);
    updateEmo('surprised', liveAnalyticsData.surprised);

    const emoValEl = document.getElementById('live-emotion-val');
    const barEmoEl = document.getElementById('bar-emotion');

    if (!webcamStream) {
        if (emoValEl) emoValEl.textContent = '📷 Kamera Kapalı';
        if (barEmoEl) barEmoEl.style.width = '0%';
    } else if (!liveAnalyticsData.faceDetected) {
        if (emoValEl) emoValEl.textContent = '😶 Yüz Algılanamadı';
        if (barEmoEl) barEmoEl.style.width = '0%';
    } else if (
        liveAnalyticsData.neutral === 0 &&
        liveAnalyticsData.happy === 0 &&
        liveAnalyticsData.angry === 0 &&
        liveAnalyticsData.sad === 0
    ) {
        if (emoValEl) emoValEl.textContent = '⏳ Model Analiz Ediyor...';
        if (barEmoEl) barEmoEl.style.width = '10%';
    } else {
        const emotionsObj = {
            '😐 Nötr': liveAnalyticsData.neutral,
            '😃 Mutlu': liveAnalyticsData.happy,
            '😢 Üzgün': liveAnalyticsData.sad,
            '😠 Kızgın': liveAnalyticsData.angry,
            '😨 Korkmuş': liveAnalyticsData.fearful,
            '🤢 Tiksinmiş': liveAnalyticsData.disgusted,
            '😲 Şaşırmış': liveAnalyticsData.surprised
        };
        const dominantEmotion = Object.keys(emotionsObj).reduce((a, b) => emotionsObj[a] > emotionsObj[b] ? a : b);
        if (emoValEl) emoValEl.textContent = `${dominantEmotion} (%${emotionsObj[dominantEmotion]})`;
        if (barEmoEl) barEmoEl.style.width = `${emotionsObj[dominantEmotion]}%`;
    }

    const audioValEl = document.getElementById('live-audio-val');
    if (audioValEl) audioValEl.textContent = `${liveAnalyticsData.decibels} dB (${liveAnalyticsData.decibels > 65 ? 'Yüksek' : 'Sessiz'})`;

    const barAudioEl = document.getElementById('bar-audio');
    if (barAudioEl) barAudioEl.style.width = `${Math.min(100, liveAnalyticsData.decibels * 1.2)}%`;

    const screenValEl = document.getElementById('live-screen-val');
    if (screenValEl) screenValEl.textContent = `%${liveAnalyticsData.screenSafety} Temiz`;

    const barScreenEl = document.getElementById('bar-screen');
    if (barScreenEl) barScreenEl.style.width = `${liveAnalyticsData.screenSafety}%`;

    const keyValEl = document.getElementById('live-keyboard-val');
    if (keyValEl) keyValEl.textContent = `%${liveAnalyticsData.keyboardStress} ${liveAnalyticsData.keyboardStress > 60 ? 'Yüksek' : 'Normal'}`;

    const barKeyEl = document.getElementById('bar-keyboard');
    if (barKeyEl) barKeyEl.style.width = `${liveAnalyticsData.keyboardStress}%`;

    const healthBadge = document.getElementById('overall-health-badge');
    if (healthBadge) {
        const score = Math.round((liveAnalyticsData.neutral + liveAnalyticsData.happy + liveAnalyticsData.screenSafety) / 2.1);
        healthBadge.textContent = `%${score} GÜVENLİ`;
        healthBadge.style.color = score > 75 ? '#34d399' : '#f59e0b';
    }
}

function startLiveAnalyticsLoop() {
    // Duplicate interval koruması — logout/login döngüsünde birden fazla interval açılmasını engeller
    if (liveAnalyticsLoopStarted) return;
    liveAnalyticsLoopStarted = true;
    setInterval(() => {
        if (!currentUser) return;
        updateEmotionUI();
    }, 1500);
}

// RAPORLAR VE EĞİTİCİ İÇERİKLER
async function loadReports() {
    const container = document.getElementById('reports-container');
    if (!container) return;

    try {
        const reports = await apiRequest('/reports');
        if (!reports || reports.length === 0) {
            container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 10px;">Henüz kaydedilmiş bir risk olayı bulunmuyor.</div>';
            return;
        }

        container.innerHTML = reports.map(r => {
            let riskClass = 'report-risk-low';
            if (r.score >= 70) riskClass = 'report-risk-high';
            else if (r.score >= 40) riskClass = 'report-risk-medium';

            const timeStr = new Date(r.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            return `
                <div class="report-item ${riskClass}">
                    <div>
                        <strong style="color: white;">${r.title || 'Risk Uyarısı'}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${r.details || ''}</div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: 700; color: ${r.score >= 70 ? 'var(--danger)' : r.score >= 40 ? 'var(--warning)' : 'var(--secondary)'};">%${r.score}</span>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${timeStr}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--danger); text-align: center;">Raporlar yüklenirken hata oluştu.</div>';
    }
}

async function fetchRecommendations() {
    try {
        recommendationsList = await apiRequest('/guidance/recommendations');
    } catch (err) {
        console.error('Öneriler alınamadı:', err);
    }
}

// REHBERLİK VE MÜDAHALE MEKANİZMASI (Section 3.5 of PDF)
// severity: 'info' | 'warning' | 'critical' (default: 'critical')
function triggerGuidanceModal(riskData) {
    const severity   = riskData.severity || 'critical';
    const notifType  = riskData.notifType || 'default';

    // Zaten modal açıksa yeni bir tane açma
    if (guidanceActive) return;

    // INFO ve WARNING → toast ile göster, uygulamayı bloklama
    if (severity === 'info' || severity === 'warning') {
        if (canShowNotification(notifType)) {
            markNotificationShown(notifType);
            showToastNotification(riskData.description || riskData.title, severity);
            apiRequest('/reports', 'POST', {
                title:   riskData.title || 'İçerik Uyarısı',
                details: riskData.description,
                score:   riskData.score || 40,
                action:  'Toast Bildirim Gösterildi'
            }).catch(() => {});
        }
        return;
    }

    // CRITICAL → Modal göster (cooldown kontrolü ile)
    if (!canShowNotification(notifType)) return;
    markNotificationShown(notifType);

    guidanceActive = true;

    const modal  = document.getElementById('guidance-modal');
    const textEl = document.getElementById('guidance-text');
    const recBox = document.getElementById('guidance-recommendation');

    if (textEl) textEl.textContent = riskData.description || 'İncelediğiniz içerikte hassas veya olumsuz unsurlar bulunabilir.';

    if (recBox && recommendationsList.length > 0) {
        const randomRec = recommendationsList[Math.floor(Math.random() * recommendationsList.length)];
        recBox.innerHTML = `
            <span class="rec-tag">${randomRec.tag || 'ÖNERİLEN EĞİTİCİ İÇERİK'}</span>
            <div class="rec-title">${randomRec.title}</div>
            <div class="rec-desc">${randomRec.description}</div>
        `;
        recBox.dataset.url = randomRec.url;
    }

    if (modal) modal.classList.remove('hidden');

    apiRequest('/reports', 'POST', {
        title:   riskData.title || 'İçerik Uyarısı',
        details: riskData.description,
        score:   riskData.score || 75,
        action:  'Rehberlik Uyarısı Gösterildi'
    }).catch(() => {});
}

function simulateRiskAlert() {
    setTestEmotion('angry');
    liveAnalyticsData.screenSafety = 35;
    triggerGuidanceModal({
        title: 'Örnek Hassas İçerik Uyarısı',
        description: 'Bu içerikte şiddet veya olumsuz ifadeler tespit edildi (%65 Risk). Dijital sağlığınız için eğitici alternatifler tavsiye edilmektedir.',
        score: 65
    });
}

function closeGuidanceModal() {
    const modal = document.getElementById('guidance-modal');
    if (modal) modal.classList.add('hidden');
    guidanceActive = false;
    _guidanceClosedAt = Date.now(); // Yeniden açılmayı REOPEN_BLOCK_MS süre engelle
    liveAnalyticsData.screenSafety = 98;
    // setTestEmotion kaldırıldı — kapatma sırasında yapay duygu değişimi gerekmez
}

function acceptRecommendation() {
    const recBox = document.getElementById('guidance-recommendation');
    const targetUrl = recBox.dataset.url || 'https://bilimcocuk.tubitak.gov.tr';
    window.open(targetUrl, '_blank');
    closeGuidanceModal();
}

function continueContent() {
    alert('Seçiminiz kaydedildi. Dijital farkındalığınızı korumayı unutmayın!');
    closeGuidanceModal();
}

// ==========================================
// 1. EBEVEYN KALICI GEÇMİŞİ VE FİLTRELEME
// ==========================================
let currentHistoryFilter = 'today';
let activeDateRange = { startDate: null, endDate: null };

function setHistoryFilter(filterType) {
    currentHistoryFilter = filterType;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));

    const activeBtn = document.getElementById(`filter-btn-${filterType}`);
    if (activeBtn) activeBtn.classList.add('active');

    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (filterType === 'today') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        startDate = todayStart.toISOString();
    } else if (filterType === 'yesterday') {
        const yestStart = new Date();
        yestStart.setDate(yestStart.getDate() - 1);
        yestStart.setHours(0, 0, 0, 0);
        const yestEnd = new Date();
        yestEnd.setDate(yestEnd.getDate() - 1);
        yestEnd.setHours(23, 59, 59, 999);
        startDate = yestStart.toISOString();
        endDate = yestEnd.toISOString();
    } else if (filterType === '7days') {
        const d7 = new Date();
        d7.setDate(d7.getDate() - 7);
        startDate = d7.toISOString();
    } else if (filterType === '30days') {
        const d30 = new Date();
        d30.setDate(d30.getDate() - 30);
        startDate = d30.toISOString();
    }

    activeDateRange = { startDate, endDate };
    loadHistoryEvents(startDate, endDate);
    loadDailySummary();
}

async function loadHistoryEvents(startDate, endDate) {
    const container = document.getElementById('parent-history-list');
    if (!container) return;

    let query = '';
    if (startDate) query += `?startDate=${encodeURIComponent(startDate)}`;
    if (endDate) query += `${query ? '&' : '?'}endDate=${encodeURIComponent(endDate)}`;

    try {
        const events = await apiRequest(`/history${query}`);
        const countBadge = document.getElementById('history-count-badge');
        if (countBadge) countBadge.textContent = `${events ? events.length : 0} Kayıt Bulundu`;

        if (!events || events.length === 0) {
            container.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 12px;">Seçilen dönemde kaydedilmiş bir riskli aktivite bulunmuyor.</div>';
            return;
        }

        container.innerHTML = events.map(e => {
            let badgeColor = 'var(--secondary)';
            if (e.score >= 70) badgeColor = 'var(--danger)';
            else if (e.score >= 45) badgeColor = 'var(--warning)';

            const timeStr = new Date(e.timestamp).toLocaleString('tr-TR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            return `
                <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border-color); border-left: 3px solid ${badgeColor}; padding: 10px 12px; border-radius: 8px; font-size: 0.82rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <strong style="color: white;">${e.title || 'Risk Olayı Kaydı'}</strong>
                        <span style="font-weight: 700; color: ${badgeColor};">%${e.score || 0} Risk</span>
                    </div>
                    <div style="font-size: 0.76rem; color: #cbd5e1; margin-bottom: 4px;">${e.details || ''}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                        <span>📍 Kategori: ${e.category || 'Genel Risk'}</span>
                        <span>🕒 ${timeStr}</span>
                    </div>
                    ${e.parentTip ? `<div style="font-size: 0.72rem; color: #a5b4fc; margin-top: 4px; background: rgba(99,102,241,0.1); padding: 4px 6px; border-radius: 4px;">💡 AI Önerisi: ${e.parentTip}</div>` : ''}
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--danger); text-align: center;">Geçmiş verileri yüklenemedi.</div>';
    }
}

async function loadDailySummary() {
    try {
        const summary = await apiRequest('/summary/daily');
        const screentimeEl = document.getElementById('summary-screentime');
        const topappsEl = document.getElementById('summary-topapps');
        const aievalEl = document.getElementById('summary-aieval');

        if (screentimeEl) screentimeEl.textContent = summary.totalScreenTimeFormatted || '2 saat 40 dakika';
        if (topappsEl) topappsEl.textContent = summary.topApps ? summary.topApps.join(', ') : 'TÜBİTAK Bilim, Scratch';
        if (aievalEl) aievalEl.textContent = summary.aiEvaluation || 'Güvenli kullanım tespit edildi.';
    } catch (e) {}
}

// ==========================================
// 2. PROFESYONEL PDF RAPORU İNDİRME
// ==========================================
async function downloadPDFReport() {
    const token = localStorage.getItem('accessToken') || localStorage.getItem('token');
    try {
        const response = await fetch(`${API_BASE}/reports/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                startDate: activeDateRange.startDate,
                endDate: activeDateRange.endDate,
                childName: currentUser ? currentUser.username : 'Çocuk',
                dateRangeText: currentHistoryFilter.toUpperCase() + ' Raporu'
            })
        });

        if (!response.ok) throw new Error('PDF oluşturulamadı');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Dijital_Rehberlik_Raporu_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        alert('PDF Raporu indirilemedi: ' + err.message);
    }
}

// ==========================================
// 3. SES TANIMA & METİN OKUMA (VOICE AI ENGINE)
// ==========================================
let activeSpeechRecognition = null;
let activeListeningInputId = null;

function toggleVoiceRecognition(targetInputId, btnId, badgeId) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert('Tarayıcınız veya ortamınız mikrofonla ses tanımayı (SpeechRecognition) desteklemiyor. Lütfen klavye ile yazınız.');
        return;
    }

    const btn = document.getElementById(btnId);
    const badge = document.getElementById(badgeId);
    const input = document.getElementById(targetInputId);

    // Zaten dinliyorsa durdur
    if (activeSpeechRecognition && activeListeningInputId === targetInputId) {
        try { activeSpeechRecognition.stop(); } catch (e) {}
        activeSpeechRecognition = null;
        activeListeningInputId = null;
        if (btn) btn.classList.remove('listening');
        if (badge) badge.classList.add('hidden');
        return;
    }

    // Başka bir aktif tanıma varsa durdur
    if (activeSpeechRecognition) {
        try { activeSpeechRecognition.stop(); } catch (e) {}
        document.querySelectorAll('.voice-btn').forEach(b => b.classList.remove('listening'));
        document.querySelectorAll('.voice-live-badge').forEach(b => b.classList.add('hidden'));
    }

    try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'tr-TR';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        activeSpeechRecognition = recognition;
        activeListeningInputId = targetInputId;

        if (btn) btn.classList.add('listening');
        if (badge) badge.classList.remove('hidden');

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join('');
            if (input) input.value = transcript;
        };

        recognition.onerror = (event) => {
            console.warn('[VOICE] Ses tanıma uyarısı:', event.error);
            if (btn) btn.classList.remove('listening');
            if (badge) badge.classList.add('hidden');
            activeSpeechRecognition = null;
            activeListeningInputId = null;
        };

        recognition.onend = () => {
            if (btn) btn.classList.remove('listening');
            if (badge) badge.classList.add('hidden');
            activeSpeechRecognition = null;
            activeListeningInputId = null;

            // Eğer sesli metin başarıyla alındıysa otomatik gönder
            if (input && input.value.trim().length > 0) {
                if (targetInputId === 'child-ai-input') {
                    sendChildAIChat();
                } else if (targetInputId === 'parent-ai-input') {
                    sendParentAIChat();
                }
            }
        };

        recognition.start();
    } catch (err) {
        console.warn('[VOICE] Ses tanıma başlatılamadı:', err.message);
        if (btn) btn.classList.remove('listening');
        if (badge) badge.classList.add('hidden');
        activeSpeechRecognition = null;
        activeListeningInputId = null;
    }
}

// Sesli Yanıt Okuma (Text-To-Speech)
let currentUtterance = null;

function speakAIText(text, speakBtn) {
    if (!('speechSynthesis' in window)) return;

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        if (speakBtn && speakBtn.dataset.speaking === 'true') {
            speakBtn.textContent = '🔊 Dinle';
            speakBtn.dataset.speaking = 'false';
            return;
        }
    }

    // Markdown ve emojileri temizleyerek akıcı seslendir
    const cleanText = text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[🤖✨🌸🔐🤗🎁🛡️💛🎮📚👋💡👨‍👩‍👧🌱📊🧩🧮📐🌧️🦖💻😂🐢🪐☀️🚀🔴]/g, '')
        .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'tr-TR';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Türkçe ses bulmaya çalış
    const voices = window.speechSynthesis.getVoices();
    const trVoice = voices.find(v => v.lang.includes('tr') || v.lang.includes('TR'));
    if (trVoice) utterance.voice = trVoice;

    if (speakBtn) {
        speakBtn.textContent = '⏹️ Durdur';
        speakBtn.dataset.speaking = 'true';
    }

    utterance.onend = () => {
        if (speakBtn) {
            speakBtn.textContent = '🔊 Dinle';
            speakBtn.dataset.speaking = 'false';
        }
    };

    utterance.onerror = () => {
        if (speakBtn) {
            speakBtn.textContent = '🔊 Dinle';
            speakBtn.dataset.speaking = 'false';
        }
    };

    window.speechSynthesis.speak(utterance);
}

// ==========================================
// 4. ÇOCUK İÇİN CHATGPT TARZI REHBER ASİSTAN
// ==========================================
let childChatHistory = [];

function formatMessageContent(raw) {
    if (!raw) return '';
    return raw
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;color:#fcd34d;">$1</code>')
        .replace(/\n/g, '<br>');
}

function askGuideAI(questionText) {
    const input = document.getElementById('child-ai-input');
    if (input) input.value = questionText;
    sendChildAIChat();
}

async function sendChildAIChat() {
    const input = document.getElementById('child-ai-input');
    const thread = document.getElementById('child-ai-chat-thread');
    if (!input || !thread) return;

    const text = input.value.trim();
    if (!text) return;

    // Kullanıcı mesajını geçmişe ve ekrana ekle
    childChatHistory.push({ role: 'user', content: text });

    const userMsg = document.createElement('div');
    userMsg.style.cssText = 'align-self: flex-end; background: var(--primary); padding: 8px 12px; border-radius: 10px; font-size: 0.82rem; color: white; max-width: 85%; box-shadow: 0 2px 8px rgba(0,0,0,0.2); animation: fadeIn 0.2s ease;';
    userMsg.textContent = `🧒 Sen: ${text}`;
    thread.appendChild(userMsg);

    input.value = '';
    thread.scrollTop = thread.scrollHeight;

    // Yükleniyor baloncuğu
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = 'align-self: flex-start; background: rgba(30, 41, 59, 0.8); padding: 8px 12px; border-radius: 10px; font-size: 0.82rem; color: #94a3b8; border: 1px solid var(--border-color); animation: fadeIn 0.2s ease;';
    loadingMsg.innerHTML = '🤖 <em>Akıllı asistan düşünüyor...</em>';
    thread.appendChild(loadingMsg);
    thread.scrollTop = thread.scrollHeight;

    try {
        const res = await apiRequest('/ai/child-guide', 'POST', { 
            question: text,
            history: childChatHistory.slice(-8)
        });

        if (loadingMsg.parentNode) thread.removeChild(loadingMsg);

        const reply = res.response || '🤖 Ben senin dijital rehber asistanınım! Her zaman yanındayım.';
        childChatHistory.push({ role: 'assistant', content: reply });

        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'align-self: flex-start; background: rgba(16, 185, 129, 0.2); padding: 10px 14px; border-radius: 10px; font-size: 0.82rem; color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.3); max-width: 90%; line-height: 1.45; animation: fadeIn 0.2s ease;';
        
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = formatMessageContent(reply);
        aiMsg.appendChild(contentDiv);

        // Sesli Okuma Butonu
        const voiceActionRow = document.createElement('div');
        voiceActionRow.style.cssText = 'margin-top: 6px; display: flex; justify-content: flex-end;';
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'tts-speak-btn';
        ttsBtn.textContent = '🔊 Dinle';
        ttsBtn.onclick = () => speakAIText(reply, ttsBtn);
        voiceActionRow.appendChild(ttsBtn);
        aiMsg.appendChild(voiceActionRow);

        thread.appendChild(aiMsg);
        thread.scrollTop = thread.scrollHeight;
    } catch (err) {
        if (loadingMsg.parentNode) thread.removeChild(loadingMsg);
        
        const fallback = '🤖 Harika bir soru! İnternette tanımadığın kişilerle şifre, adres veya fotoğraf paylaşmamalısın. Seni endişelendiren bir durum olduğunda anne veya babana haber ver!';
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'align-self: flex-start; background: rgba(16, 185, 129, 0.2); padding: 10px 14px; border-radius: 10px; font-size: 0.82rem; color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.3); max-width: 90%;';
        aiMsg.innerHTML = formatMessageContent(fallback);
        thread.appendChild(aiMsg);
        thread.scrollTop = thread.scrollHeight;
    }
}

// ==========================================
// 5. EBEVEYN İÇİN CHATGPT TARZI DANIŞMANLIK
// ==========================================
let parentChatHistory = [];

function askParentAI(questionText) {
    const input = document.getElementById('parent-ai-input');
    if (input) input.value = questionText;
    sendParentAIChat();
}

async function sendParentAIChat() {
    const input = document.getElementById('parent-ai-input');
    const thread = document.getElementById('parent-ai-chat-thread');
    if (!input || !thread) return;

    const text = input.value.trim();
    if (!text) return;

    parentChatHistory.push({ role: 'user', content: text });

    const userMsg = document.createElement('div');
    userMsg.style.cssText = 'align-self: flex-end; background: var(--secondary); padding: 8px 12px; border-radius: 10px; font-size: 0.82rem; color: white; max-width: 85%; animation: fadeIn 0.2s ease;';
    userMsg.textContent = `👨‍👩‍👧 Siz: ${text}`;
    thread.appendChild(userMsg);

    input.value = '';
    thread.scrollTop = thread.scrollHeight;

    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = 'align-self: flex-start; background: rgba(30, 41, 59, 0.8); padding: 8px 12px; border-radius: 10px; font-size: 0.82rem; color: #94a3b8; border: 1px solid var(--border-color); animation: fadeIn 0.2s ease;';
    loadingMsg.innerHTML = '👨‍👩‍👧 <em>Ebeveyn danışmanı yanıt hazırlıyor...</em>';
    thread.appendChild(loadingMsg);
    thread.scrollTop = thread.scrollHeight;

    try {
        const res = await apiRequest('/ai/parent-guide', 'POST', { 
            question: text,
            history: parentChatHistory.slice(-8)
        });
        if (loadingMsg.parentNode) thread.removeChild(loadingMsg);

        const reply = res.response || '👨‍👩‍👧 Çocuğunuzla açık ve şeffaf bir diyalog kurmanız dijital farkındalık için en etkili yoldur.';
        parentChatHistory.push({ role: 'assistant', content: reply });

        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'align-self: flex-start; background: rgba(16, 185, 129, 0.2); padding: 10px 14px; border-radius: 10px; font-size: 0.82rem; color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.3); max-width: 90%; line-height: 1.45; animation: fadeIn 0.2s ease;';
        
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = formatMessageContent(reply);
        aiMsg.appendChild(contentDiv);

        // Sesli Okuma Butonu
        const voiceActionRow = document.createElement('div');
        voiceActionRow.style.cssText = 'margin-top: 6px; display: flex; justify-content: flex-end;';
        const ttsBtn = document.createElement('button');
        ttsBtn.className = 'tts-speak-btn';
        ttsBtn.textContent = '🔊 Dinle';
        ttsBtn.onclick = () => speakAIText(reply, ttsBtn);
        voiceActionRow.appendChild(ttsBtn);
        aiMsg.appendChild(voiceActionRow);

        thread.appendChild(aiMsg);
        thread.scrollTop = thread.scrollHeight;
    } catch (err) {
        if (loadingMsg.parentNode) thread.removeChild(loadingMsg);
        
        const fallback = '👨‍👩‍👧 **Ebeveyn Tavsiyesi:** Çocuğunuza yasak koymak yerine birlikte kurallar belirleyin. Örneğin günlük 1 saat kaliteli ekran süresi ve ardından ekransız aile saati uygulayabilirsiniz.';
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'align-self: flex-start; background: rgba(16, 185, 129, 0.2); padding: 10px 14px; border-radius: 10px; font-size: 0.82rem; color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.3); max-width: 90%;';
        aiMsg.innerHTML = formatMessageContent(fallback);
        thread.appendChild(aiMsg);
        thread.scrollTop = thread.scrollHeight;
    }
}
