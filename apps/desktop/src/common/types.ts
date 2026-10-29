import type { ChildSettings, Emotion, RiskState } from '@dr/shared';

export type Phase = 'setup' | 'consent' | 'running';

export interface AppState {
  phase: Phase;
  serverMode: 'embedded' | 'remote';
  serverUrl: string;
  /** Gömülü sunucuda ebeveyn panelinin adresleri (yerel ve ağ). */
  panelUrls: string[];
  childName: string;
  settings: ChildSettings | null;
  aiEnabled: boolean;
  online: boolean;
  risk: number;
  riskState: RiskState;
  expressions: Record<string, number>;
  lastError: string;
  isDev: boolean;
}

export interface Guidance {
  title: string;
  description: string;
  score: number;
}

export interface PairRequest {
  mode: 'embedded' | 'remote';
  serverUrl: string;
  code: string;
  deviceName?: string;
}

export interface EmotionPayload {
  emotion: Emotion;
  faceDetected: boolean;
  expressions: Record<string, number>;
}

export interface ChatResult {
  ok: boolean;
  reply?: string;
  flagged?: boolean;
  error?: string;
  assistantDisabled?: boolean;
}

export interface AgentApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  onGuidance(cb: (g: Guidance) => void): () => void;
  pair(req: PairRequest): Promise<{ ok: boolean; error?: string }>;
  acceptConsent(): Promise<void>;
  unpair(code: string): Promise<{ ok: boolean; error?: string }>;
  sendEmotion(p: EmotionPayload): void;
  sendAudioLevel(level: number): void;
  chat(message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatResult>;
  mediaStatus(): Promise<{ camera: string; microphone: string } | null>;
  openPrivacy(kind: 'camera' | 'microphone'): Promise<void>;
  openPanel(): Promise<void>;
  devSimulate(kind: 'risk' | 'clear'): Promise<void>;
}
