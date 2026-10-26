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
  autostart: boolean;
  lanAccess: boolean;
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
  unpair(): Promise<void>;
  sendEmotion(p: EmotionPayload): void;
  sendAudioLevel(level: number): void;
  chat(message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatResult>;
  openPanel(): Promise<void>;
  setAutostart(enabled: boolean): Promise<void>;
  setLanAccess(enabled: boolean): Promise<void>;
  devSimulate(kind: 'risk' | 'clear'): Promise<void>;
}
