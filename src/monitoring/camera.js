// src/monitoring/camera.js
const path = require('path');
let faceapi = null;
let canvas = null;
let isModelLoaded = false;

try {
    faceapi = require('face-api.js');
    try {
        canvas = require('canvas');
        const { Canvas, Image, ImageData } = canvas;
        faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
    } catch (cErr) {
        // Node canvas binary yüklü değilse hafif mod
    }
} catch (e) {
    console.warn('[KAMERA] face-api.js yüklenemedi, hafif istemci modu devrede.');
}

let emotionHistory = [];
let detectorOptions = null;

async function loadModels() {
    if (!faceapi || !canvas) {
        console.log('[KAMERA] İstemci taraflı optimize analiz modu hazır (RAM tasarrufu aktif).');
        return;
    }
    console.log('[KAMERA] Yüz analizi modelleri yükleniyor...');
    try {
        detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
        const modelsPath = path.join(__dirname, '../../models');
        await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsPath);
        await faceapi.nets.faceExpressionNet.loadFromDisk(modelsPath);
        isModelLoaded = true;
        console.log('[KAMERA] Modeller başarıyla yüklendi:', modelsPath);
    } catch (err) {
        console.warn('[KAMERA] Model diskten yüklenemedi, istemci analizi kullanılacak:', err.message);
    }
}

/**
 * Renderer'dan gelen base64 veri URL'ini (data:image/jpeg;base64,...) analiz eder.
 * Yüz tespit edilirse 7 duygu yüzdesini (0-100) ve dominant duyguyu döndürür.
 * Yüz bulunamazsa null döndürür — sahte değer üretmez.
 *
 * @param {string} dataUrl - canvas.toDataURL() sonucu
 * @returns {Promise<{expressions: Object, dominantEmotion: string, stableEmotion: string, faceDetected: true}|null>}
 */
async function analyzeFrame(dataUrl) {
    try {
        if (!isModelLoaded || !canvas || !faceapi) return null;
        if (!dataUrl || typeof dataUrl !== 'string') return null;

        // base64 → Buffer → canvas Image
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        const img = await canvas.loadImage(buffer);

        // Önce tek yüz dene (en hızlı ve baskın yüz), yoksa çoklu yüz dene
        let detection = await faceapi
            .detectSingleFace(img, detectorOptions)
            .withFaceExpressions();

        if (!detection) {
            const allDetections = await faceapi
                .detectAllFaces(img, detectorOptions)
                .withFaceExpressions();
            if (allDetections && allDetections.length > 0) {
                detection = allDetections[0];
            }
        }

        if (!detection || !detection.expressions) {
            // Yüz tespit edilemedi
            return null;
        }

        const rawExpressions = detection.expressions;

        // 7 temel duygu anahtarları
        const KEYS = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
        const expressions = {};
        
        // 0 - 100 tam sayı yüzdesi
        KEYS.forEach(k => {
            expressions[k] = Math.max(0, Math.min(100, Math.round((rawExpressions[k] || 0) * 100)));
        });

        // Dominant duygu (en yüksek ham değere sahip duygu)
        const dominantEmotion = KEYS.reduce((a, b) => (rawExpressions[a] || 0) > (rawExpressions[b] || 0) ? a : b);

        // Kararlı duygu oylaması (Risk Engine için)
        emotionHistory.push(dominantEmotion);
        if (emotionHistory.length > 5) emotionHistory.shift();
        const counts = {};
        emotionHistory.forEach(e => counts[e] = (counts[e] || 0) + 1);
        const stableEmotion = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);

        return {
            faceDetected: true,
            expressions,       // { neutral: 75, happy: 15, sad: 2, ... }
            dominantEmotion,   // 'neutral' / 'happy' / 'sad' vb.
            stableEmotion
        };
    } catch (error) {
        console.error('[KAMERA] Frame analiz hatası:', error.message);
        return null;
    }
}

module.exports = { loadModels, analyzeFrame };
