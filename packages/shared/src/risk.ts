export type Emotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised';

export const EMOTIONS: Emotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
];

export const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: 'Nötr',
  happy: 'Mutlu',
  sad: 'Üzgün',
  angry: 'Kızgın / Stresli',
  fearful: 'Korkmuş / Endişeli',
  disgusted: 'Tiksinmiş',
  surprised: 'Şaşırmış',
};

export type Sensitivity = 'low' | 'medium' | 'high';

export interface RiskState {
  emotion: Emotion;
  /** 0-100, ekran/pencere içerik riski */
  windowRisk: number;
  /** 0-100, ses riski */
  audioRisk: number;
  /** 0-100, klavye (hızlı/panik tuşlama) riski */
  keyboardRisk: number;
  windowTitle: string;
}

export const EMPTY_RISK_STATE: RiskState = {
  emotion: 'neutral',
  windowRisk: 0,
  audioRisk: 0,
  keyboardRisk: 0,
  windowTitle: '',
};

/** Hassasiyet ayarına göre toplam puanın çarpanı ve olay eşiği. */
export const SENSITIVITY_PROFILE: Record<
  Sensitivity,
  { multiplier: number; eventThreshold: number }
> = {
  low: { multiplier: 0.8, eventThreshold: 70 },
  medium: { multiplier: 1, eventThreshold: 60 },
  high: { multiplier: 1.2, eventThreshold: 50 },
};

export const GUIDANCE_THRESHOLD = 75;

const HIGH_RISK_KEYWORDS = [
  'kumar',
  'bahis',
  'casino',
  'yetişkin',
  'porno',
  'canlı bahis',
  'silah satın al',
  'dehşet şiddet',
  'cinayet kan',
];
const MEDIUM_RISK_KEYWORDS = ['bıçak', 'kavga', 'korkunç', 'tehlikeli oyun'];

/** Aktif pencere başlığı/uygulama adından içerik riski (0-100). */
export function windowRiskFromTitle(title: string, owner = ''): number {
  const text = `${title} ${owner}`.toLocaleLowerCase('tr-TR');
  if (HIGH_RISK_KEYWORDS.some((k) => text.includes(k))) return 85;
  if (MEDIUM_RISK_KEYWORDS.some((k) => text.includes(k))) return 45;
  return 0;
}

/** Son 5 sn'deki tuş sayısından klavye riski (0-100). */
export function keyboardRiskFromCount(keyPressesIn5s: number): number {
  if (keyPressesIn5s <= 0) return 0;
  return Math.min(100, Math.round((keyPressesIn5s / 25) * 80));
}

/** Göreli ses seviyesinden (0-100) ses riski. */
export function audioRiskFromLevel(level: number): number {
  if (level > 80) return 85;
  if (level > 65) return 45;
  return 0;
}

/** 0-100 arası toplam risk puanı. Saf fonksiyondur. */
export function computeRisk(state: RiskState, sensitivity: Sensitivity = 'medium'): number {
  let score = 0;
  if (state.windowRisk > 0) score += Math.min(50, state.windowRisk * 0.6);
  if (state.audioRisk > 40) score += Math.min(25, (state.audioRisk - 40) * 0.5);
  if (state.emotion === 'angry') score += 25;
  else if (state.emotion === 'fearful') score += 20;
  else if (state.emotion === 'sad') score += 15;
  if (state.keyboardRisk > 50) score += Math.min(15, (state.keyboardRisk - 50) * 0.3);
  const scaled = score * SENSITIVITY_PROFILE[sensitivity].multiplier;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function riskCategory(state: RiskState): string {
  if (state.windowRisk > 50) return 'Sakıncalı İçerik / Sayfa';
  if (state.audioRisk > 60) return 'Yüksek Ses / Bağrışma';
  if (state.emotion === 'angry' || state.emotion === 'fearful' || state.emotion === 'sad') {
    return 'Duygu Durumu Değişimi';
  }
  return 'İçerik Risk Uyarısı';
}

/** Risk durumunu ebeveyne gösterilecek kısa metne çevirir. */
export function describeState(state: RiskState): string {
  const parts = [`Duygu: ${EMOTION_LABELS[state.emotion]}`];
  if (state.windowTitle) {
    const t =
      state.windowTitle.length > 40 ? `${state.windowTitle.slice(0, 37)}...` : state.windowTitle;
    parts.push(`Açık sayfa/uygulama: "${t}"`);
  }
  if (state.audioRisk > 40) parts.push('Ortam: yüksek ses / bağrışma');
  if (state.keyboardRisk > 50) parts.push('Etkileşim: hızlı / panik klavye tuşlaması');
  return parts.join(' | ');
}

export function guidanceReasons(state: RiskState): string[] {
  const r: string[] = [];
  if (state.windowRisk >= 80) r.push('Ekran penceresinde hassas/sakıncalı içerik tespiti');
  if (state.audioRisk >= 50) r.push('Çevrede yüksek ses veya çığlık');
  if (state.keyboardRisk >= 50) r.push('Hızlı/aşırı klavye etkileşimi');
  if (state.emotion === 'angry' || state.emotion === 'fearful') {
    r.push(`Anlık duygu durumu: ${EMOTION_LABELS[state.emotion]}`);
  }
  return r;
}
