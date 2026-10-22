// src/monitoring/audio.js
const record = require('node-record-lpcm16');
const fs = require('fs');
const riskEngine = require('../core/riskEngine');

const WINDOWS_MICROPHONE_DEVICE = 'Mikrofon (Realtek(R) Audio)';
let volumeHistory = [];
let recording = null;
let recordingStream = null;

function startAudioMonitoring() {
    if (recording) return true;

    // Fail closed: never fall back silently to an unspecified microphone.
    if (process.platform !== 'win32' || !process.env.SOX_EXECUTABLE || !fs.existsSync(process.env.SOX_EXECUTABLE)) {
        console.warn('Ses takibi başlatılmadı: yapılandırılmış Windows SoX akışı hazır değil.');
        return false;
    }

    console.log("Ses ve desibel analizi başlatılıyor...");

    try {
        // node-record-lpcm16 maps `device` to AUDIODEV. AUDIODRIVER=waveaudio
        // is configured by main.js for the Windows MME device-name lookup.
        recording = record.record({
            recorder: 'sox',
            sampleRate: 16000,
            channels: 1,
            audioType: 'raw',
            device: WINDOWS_MICROPHONE_DEVICE
        });

        recordingStream = recording.stream();

        recordingStream.on('data', (chunk) => {
            if (!chunk || chunk.length === 0) return;

            let sumSquare = 0;
            // 16-bit PCM varsayılarak örnekleme
            for (let i = 0; i < chunk.length - 1; i += 2) {
                const sample = chunk.readInt16LE(i);
                sumSquare += sample * sample;
            }
            
            const numSamples = chunk.length / 2;
            const rms = Math.sqrt(sumSquare / numSamples);
            // 0 - 100 arası desibel (dB) ölçekleme
            // This is not physical SPL/dB. It is a relative 0-100 application
            // metric derived from 16-bit PCM RMS; keep thresholds accordingly.
            const dB = Math.min(100, Math.max(15, Math.round(20 + (rms / 32768) * 80)));

            // Hareketli ortalama (son 10 veri noktası) ile gürültü filtresi
            volumeHistory.push(dB);
            if (volumeHistory.length > 10) volumeHistory.shift();

            const avgDB = Math.round(volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length);

            let riskScore = 0;
            if (avgDB > 80) {
                riskScore = 85; // Aşırı yüksek ses / bağrışma / çığlık
            } else if (avgDB > 65) {
                riskScore = 45; // Yüksek konuşma sesi
            }

            riskEngine.updateState('audioRisk', riskScore);
            riskEngine.updateState('audioDecibels', avgDB);
        });

        recordingStream.once('error', () => stopAudioMonitoring());
        recording.process.on('error', (err) => {
            console.warn('SoX başlatılamadı; mikrofon kapatılıyor:', err.message || err);
            stopAudioMonitoring();
        });
        recording.process.on('exit', (code) => {
            if (code && recording) {
                console.warn(`SoX hedef mikrofonu kullanamadı (çıkış kodu: ${code}); mikrofon kapalı.`);
                recording = null;
                recordingStream = null;
            }
        });

        return true;

        recordingStream.on('error', (err) => {
            console.warn("Ses kaydı akış uyarısı (isteğe bağlı):", err.message || err);
        });
    } catch (e) {
        console.warn("Ses modülü başlatılamadı:", e.message);
    }
}

function stopAudioMonitoring() {
    const activeRecording = recording;
    recording = null;
    recordingStream = null;
    volumeHistory = [];

    if (activeRecording) {
        try {
            activeRecording.stop();
        } catch (e) {
            console.warn('Ses kaydı durdurulurken uyarı:', e.message);
        }
    }

    riskEngine.updateState('audioRisk', 0);
    riskEngine.updateState('audioDecibels', 25);
}

function isAudioMonitoringActive() {
    return recording !== null;
}

module.exports = { startAudioMonitoring, stopAudioMonitoring, isAudioMonitoringActive };

