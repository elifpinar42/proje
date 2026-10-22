const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// node-record-lpcm16 runs the `sox` command on Windows. Do not use node-mic's
// unused bundled path; resolve the verified system installation instead.
const SOX_EXECUTABLE = process.env.SOX_EXECUTABLE || 'C:\\Program Files (x86)\\sox-14-4-2\\sox.exe';
if (fs.existsSync(SOX_EXECUTABLE)) {
  process.env.SOX_EXECUTABLE = SOX_EXECUTABLE;
  process.env.PATH = `${path.dirname(SOX_EXECUTABLE)};${process.env.PATH || ''}`;
  process.env.AUDIODRIVER = 'waveaudio';
} else {
  console.warn(`[AUDIO] SoX was not found; microphone monitoring remains disabled: ${SOX_EXECUTABLE}`);
}

// Backend sürecini başlat
const backendEnv = { ...process.env };
const backendProcess = spawn('node', [path.join(__dirname, 'backend', 'index.js')], {
  stdio: 'inherit',
  shell: true,
  env: backendEnv
});

// Uygulamanın verilerini yazabileceği güvenli yer
app.setPath('userData', path.join(app.getPath('appData'), 'proje-data'));

// Monitoring Modülleri
const camera = require('./src/monitoring/camera');
const keyboard = require('./src/monitoring/keyboard');
const screen = require('./src/monitoring/screen');
const audio = require('./src/monitoring/audio');
const riskEngine = require('./src/core/riskEngine');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Microphone capture is enabled only by an explicit parent action in the UI.
ipcMain.handle('audio-monitoring:set-enabled', (event, enabled) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof enabled !== 'boolean') {
    return { ok: false, active: audio.isAudioMonitoringActive() };
  }

  if (!enabled) {
    audio.stopAudioMonitoring();
    return { ok: true, active: false };
  }

  return {
    ok: Boolean(audio.startAudioMonitoring()),
    active: audio.isAudioMonitoringActive()
  };
});

// Otomatik başlatma (Windows Startup) yönetimi
ipcMain.handle('autostart:get', () => {
  try {
    const settings = app.getLoginItemSettings();
    return { enabled: settings.openAtLogin };
  } catch (e) {
    return { enabled: false };
  }
});

ipcMain.handle('autostart:set', (event, enable) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      openAsHidden: false,
      name: 'AI Dijital İçerik Rehberlik ve Güvenlik Sistemi'
    });
    return { ok: true, enabled: !!enable };
  } catch (e) {
    console.warn('[OTO-BAŞLATMA] Ayar kaydedilemedi:', e.message);
    return { ok: false, error: e.message };
  }
});


/**
 * Backend port 3000'de hazır olana kadar bekle.
 * Her 200ms'de bir /api/health adresine ping atar.
 * Maksimum 15 saniye bekler, sonra yine de devam eder.
 */
function waitForBackend(maxWaitMs = 15000, intervalMs = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.get('http://localhost:3000/api/auth/login', { method: 'HEAD' }, () => {
        resolve(); // Backend yanıt verdi
      });
      req.on('error', () => {
        if (Date.now() - start >= maxWaitMs) {
          console.warn('[UYARI] Backend 15 saniyede ayağa kalkmadı, yine de devam ediliyor.');
          resolve();
        } else {
          setTimeout(check, intervalMs);
        }
      });
      req.end();
    };
    check();
  });
}

async function startMonitoring() {
  try {
    await camera.loadModels();
  } catch (e) {
    console.log('Kamera modeli yüklenemedi, isteğe bağlı atlandı.');
  }

  screen.monitorScreen();

  try {
    // Audio is intentionally not started here. It requires explicit UI consent.
  } catch (e) {
    console.log('Ses takibi başlatılamadı, isteğe bağlı atlandı.');
  }

  try {
    keyboard.startMonitoring();
  } catch (e) {
    console.log('Klavye dinleyici başlatılamadı, isteğe bağlı atlandı.');
  }

  // IPC: Renderer'dan gelen kamera frame'ini (data URL) analiz et
  ipcMain.on('frame-data', async (event, dataUrl) => {
    console.log('[KAMERA] Frame alındı, uzunluk:', dataUrl ? dataUrl.length : 0);
    const result = await camera.analyzeFrame(dataUrl);
    console.log('[KAMERA] Analiz sonucu:', result ? JSON.stringify(result) : 'null');
    if (result && result.faceDetected) {
      // Risk Engine'i kararlı duygu ile güncelle
      riskEngine.updateState('emotion', result.stableEmotion);
      // Frontend'e 7 duygu yüzdesini gönder
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('emotion-result', result);
      }
    } else {
      // Yüz bulunamadı — frontend'e bildir
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('emotion-result', { faceDetected: false });
      }
    }
  });
}

function createTray() {
  try {
    // Varsayılan ikon oluşturma veya boş geçme
    tray = new Tray(path.join(__dirname, 'frontend', 'manifest.json')); // İkon fallback
  } catch (e) {
    // İkon dosyası olmasa da sistem tepsisinde çalışabilir
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🛡️ Dijital Rehberlik Arayüzünü Aç',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '📊 Çocuğun Anlık Durum Raporu',
      click: () => {
        const state = riskEngine.getChildState();
        const { sendAlert } = require('./src/core/notifier');
        sendAlert('📊 Çocuğunuzun Anlık Durumu', `Duygu: ${state.emotion} | Pencere: ${state.windowTitle || 'Normal'} | Risk: %${state.currentRiskScore}`, true);
      }
    },
    { type: 'separator' },
    {
      label: '🚪 Tamamen Kapat (Çıkış)',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  if (tray) {
    tray.setToolTip('AI Dijital İçerik Rehberlik ve Güvenlik Sistemi (Aktif Koruma)');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    title: 'AI Dijital İçerik Rehberlik ve Güvenlik Sistemi',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false, // ARKA PLANDA / SİGME DURUMUNDAYKEN KESİNTİSİZ ÇALIŞMA
      // Electron'da mikrofon ve ses tanıma için gerekli
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Chrome'un dahili ses tanıma API'si için
      experimentalFeatures: false
    }
  });

  // Pencereyi boş açıyoruz; backend hazır olunca whenReady'de loadFile yapılacak
  // mainWindow.loadFile('frontend/index.html'); // ← whenReady'e taşındı

  // Risk Engine'e pencere referansını gönder
  riskEngine.setMainWindow(mainWindow);

  // Pencere kapatıldığında uygulamayı tamamen kapatmak yerine arka planda gizle (Tray)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      const { sendAlert } = require('./src/core/notifier');
      sendAlert('🛡️ Arka Plan Koruması Aktif', 'Uygulama arka planda diğer pencereleri ve çocuk durumunu izlemeye devam ediyor.');
      return false;
    }
  });

  startMonitoring();
  createTray();
}

app.whenReady().then(async () => {
  createWindow();
  await waitForBackend();
  // Backend hazır — UI'ı şimdi yükle
  if (mainWindow) mainWindow.loadFile('frontend/index.html');
});

app.on('before-quit', () => {
  isQuitting = true;
  audio.stopAudioMonitoring();
});

app.on('window-all-closed', () => {
  if (isQuitting) {
    try { backendProcess.kill(); } catch (e) {}
    if (process.platform !== 'darwin') app.quit();
  }
});
