import * as faceapi from '@vladmandic/face-api';
import { EMOTIONS, type Emotion } from '@dr/shared';

let modelsLoaded: Promise<void> | null = null;

function loadModels(): Promise<void> {
  if (!modelsLoaded) {
    modelsLoaded = (async () => {
      const tf = faceapi.tf as unknown as { setBackend(n: string): Promise<boolean>; ready(): Promise<void> };
      await tf.setBackend('webgl').catch(() => undefined);
      await tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
      await faceapi.nets.faceExpressionNet.loadFromUri('./models');
    })();
    modelsLoaded.catch(() => {
      modelsLoaded = null;
    });
  }
  return modelsLoaded;
}

export interface Stopper {
  stop(): void;
}

/**
 * Kamera karelerini yalnızca bu cihazda işler; görüntü hiçbir yere gönderilmez.
 * Dışarı yalnızca duygu etiketi ve yüzdeler çıkar.
 */
export async function startCamera(onResult: (r: { emotion: Emotion; faceDetected: boolean; expressions: Record<string, number> }) => void): Promise<Stopper> {
  await loadModels();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
  const history: Emotion[] = [];
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const det = await faceapi.detectSingleFace(video, options).withFaceExpressions();
      if (det) {
        const expr = det.expressions as unknown as Record<string, number>;
        const percentages: Record<string, number> = {};
        let dominant: Emotion = 'neutral';
        let best = -1;
        for (const e of EMOTIONS) {
          const v = Math.round((expr[e] ?? 0) * 100);
          percentages[e] = v;
          if (v > best) {
            best = v;
            dominant = e;
          }
        }
        // Kararlı duygu: son 5 ölçümde çoğunluk.
        history.push(dominant);
        if (history.length > 5) history.shift();
        const counts = new Map<Emotion, number>();
        for (const h of history) counts.set(h, (counts.get(h) ?? 0) + 1);
        const stable = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        onResult({ emotion: stable, faceDetected: true, expressions: percentages });
      } else {
        history.length = 0;
        onResult({ emotion: 'neutral', faceDetected: false, expressions: {} });
      }
    } catch {
      /* kare işlenemedi */
    }
    if (!stopped) setTimeout(tick, 1500);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}

/** Mikrofon: yalnızca göreli ses seviyesi (0-100) ölçülür; ses kaydedilmez. */
export async function startMic(onLevel: (level: number) => void): Promise<Stopper> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const recent: number[] = [];

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const s of buf) sum += s * s;
    const rms = Math.sqrt(sum / buf.length);
    const dbfs = 20 * Math.log10(Math.max(rms, 1e-5));
    // -60 dBFS (sessiz) .. 0 dBFS (tam ölçek) → 0..100
    const level = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
    recent.push(level);
    if (recent.length > 10) recent.shift();
    onLevel(Math.round(recent.reduce((a, b) => a + b, 0) / recent.length));
  }, 500);

  return {
    stop() {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
