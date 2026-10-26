import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import { powerMonitor } from 'electron';
import {
  EMPTY_RISK_STATE,
  GUIDANCE_THRESHOLD,
  SENSITIVITY_PROFILE,
  audioRiskFromLevel,
  computeRisk,
  describeState,
  guidanceReasons,
  keyboardRiskFromCount,
  riskCategory,
  DEFAULT_SETTINGS,
  type AgentEvent,
  type ChildSettings,
  type RiskState,
} from '@dr/shared';
import type { ChatResult, EmotionPayload, Guidance } from '../common/types';
import { KeyboardMonitor, WindowMonitor } from './monitors';
import type { EventQueue } from './queue';
import type { Store } from './store';

const ALERT_COOLDOWN_MS = 60_000;
const GUIDANCE_COOLDOWN_MS = 120_000;
const HEARTBEAT_MS = 10_000;
const SETTINGS_POLL_MS = 60_000;
const IDLE_LIMIT_S = 60;

export interface AgentSnapshot {
  settings: ChildSettings | null;
  aiEnabled: boolean;
  online: boolean;
  risk: number;
  riskState: RiskState;
  expressions: Record<string, number>;
  lastError: string;
}

interface AgentEvents {
  change: [];
  guidance: [Guidance];
  unpaired: [];
  settings: [ChildSettings];
}

/** Çocuk cihazındaki ajan: izleme modülleri → risk motoru → sunucu. */
export class Agent extends EventEmitter<AgentEvents> {
  private settings: ChildSettings | null = null;
  private aiEnabled = false;
  private online = false;
  private risk = 0;
  private riskState: RiskState = { ...EMPTY_RISK_STATE };
  private expressions: Record<string, number> = {};
  private audioLevel = 0;
  private lastError = '';
  private lastAlert = 0;
  private lastAlertKey = '';
  private lastGuidance = 0;
  private running = false;
  private hbTimer: NodeJS.Timeout | null = null;
  private setTimer: NodeJS.Timeout | null = null;
  private notifyTimer: NodeJS.Timeout | null = null;

  private windowMon = new WindowMonitor((title, risk) => {
    this.riskState.windowTitle = title;
    this.riskState.windowRisk = risk;
    this.recompute();
  });
  private keyMon = new KeyboardMonitor((count) => {
    this.riskState.keyboardRisk = keyboardRiskFromCount(count);
    this.recompute();
  });

  constructor(
    private store: Store,
    private queue: EventQueue,
    private baseUrl: () => string,
  ) {
    super();
  }

  snapshot(): AgentSnapshot {
    return {
      settings: this.settings,
      aiEnabled: this.aiEnabled,
      online: this.online,
      risk: this.risk,
      riskState: this.riskState,
      expressions: this.expressions,
      lastError: this.lastError,
    };
  }

  /* ---- Yaşam döngüsü ---- */

  async pair(code: string, deviceName?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl()}/api/agent/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, deviceName: deviceName || hostname() }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        deviceToken?: string;
        childName?: string;
        settings?: ChildSettings;
      };
      if (!res.ok || !body.deviceToken) return { ok: false, error: body.error ?? 'Eşleştirme başarısız' };
      this.store.update({ deviceToken: body.deviceToken, childName: body.childName ?? '', consentAccepted: false });
      this.settings = body.settings ?? DEFAULT_SETTINGS;
      return { ok: true };
    } catch {
      return { ok: false, error: 'Sunucuya ulaşılamadı. Adresi ve ağ bağlantısını kontrol edin.' };
    }
  }

  start(): void {
    const cfg = this.store.get();
    if (this.running || !cfg.deviceToken || !cfg.consentAccepted) return;
    this.running = true;
    // Eşleşmede alınan ayarlar yalnızca gösterim içindi; izleme modülleri ilk ayar uygulamasında başlamalı.
    this.settings = null;
    void this.pollSettings();
    this.setTimer = setInterval(() => void this.pollSettings(), SETTINGS_POLL_MS);
    this.hbTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
  }

  stop(): void {
    this.running = false;
    for (const t of [this.hbTimer, this.setTimer, this.notifyTimer]) if (t) clearInterval(t);
    this.hbTimer = this.setTimer = this.notifyTimer = null;
    this.windowMon.stop();
    this.keyMon.stop();
    this.online = false;
  }

  /** Eşleşmeyi kaldırır ve tüm yerel izleme durumunu sıfırlar. */
  unpair(): void {
    this.stop();
    this.store.update({ deviceToken: null, childName: '', consentAccepted: false });
    this.queue.clear();
    this.settings = null;
    this.aiEnabled = false;
    this.riskState = { ...EMPTY_RISK_STATE };
    this.expressions = {};
    this.risk = 0;
    this.emit('unpaired');
    this.emit('change');
  }

  /** Eşleşme yalnızca ebeveynin panelden verdiği kodla kaldırılabilir. */
  async unpairWithCode(code: string): Promise<{ ok: boolean; error?: string }> {
    const res = await this.call('/unpair', { method: 'POST', body: { code } });
    if (!res) return this.store.get().deviceToken ? { ok: false, error: 'Sunucuya ulaşılamıyor.' } : { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? 'Kod kabul edilmedi' };
    this.unpair();
    return { ok: true };
  }

  /* ---- Sunucu iletişimi ---- */

  private async call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response | null> {
    const token = this.store.get().deviceToken;
    if (!token) return null;
    try {
      const res = await fetch(`${this.baseUrl()}/api/agent${path}`, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 401) {
        // Ebeveyn cihazı kaldırdı: yerel eşleşmeyi de temizle.
        this.unpair();
        return null;
      }
      this.online = true;
      this.lastError = '';
      return res;
    } catch (e) {
      this.online = false;
      this.lastError = 'Sunucuya ulaşılamıyor';
      void e;
      return null;
    } finally {
      this.scheduleChange();
    }
  }

  private async pollSettings(): Promise<void> {
    const res = await this.call('/settings');
    if (!res?.ok) return;
    const body = (await res.json()) as { childName: string; settings: ChildSettings; aiEnabled: boolean };
    this.aiEnabled = body.aiEnabled;
    if (body.childName !== this.store.get().childName) this.store.update({ childName: body.childName });
    this.applySettings(body.settings);
  }

  private applySettings(next: ChildSettings): void {
    const prev = this.settings;
    this.settings = next;
    this.emit('settings', next);
    if (!prev || prev.screenEnabled !== next.screenEnabled) {
      if (next.screenEnabled) this.windowMon.start();
      else this.windowMon.stop();
    }
    if (!prev || prev.keyboardEnabled !== next.keyboardEnabled) {
      if (next.keyboardEnabled) void this.keyMon.start();
      else this.keyMon.stop();
    }
    if (!next.cameraEnabled) {
      this.riskState.emotion = 'neutral';
      this.expressions = {};
    }
    if (!next.micEnabled) {
      this.audioLevel = 0;
      this.riskState.audioRisk = 0;
    }
    this.recompute();
  }

  private async heartbeat(): Promise<void> {
    const active = powerMonitor.getSystemIdleTime() < IDLE_LIMIT_S;
    const res = await this.call('/heartbeat', {
      method: 'POST',
      body: {
        riskScore: this.risk,
        emotion: this.riskState.emotion,
        windowTitle: this.settings?.screenEnabled ? this.riskState.windowTitle.slice(0, 300) : '',
        audioLevel: Math.round(this.audioLevel),
        keyboardRisk: this.riskState.keyboardRisk,
        expressions: this.settings?.cameraEnabled ? this.expressions : undefined,
        activeSeconds: active ? HEARTBEAT_MS / 1000 : 0,
      },
    });
    if (!res?.ok) return;
    const body = (await res.json()) as { settings?: ChildSettings };
    if (body.settings) this.applySettings(body.settings);
    await this.flushQueue();
  }

  private async sendEvent(event: AgentEvent): Promise<boolean> {
    const res = await this.call('/events', { method: 'POST', body: event });
    return !!res?.ok;
  }

  private async flushQueue(): Promise<void> {
    for (const item of this.queue.peek()) {
      if (!(await this.sendEvent(item.event))) return;
      this.queue.remove(item.id);
    }
  }

  async chat(message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatResult> {
    const res = await this.call('/chat', { method: 'POST', body: { message, history } });
    if (!res) return { ok: false, error: 'Sunucuya ulaşılamıyor. Biraz sonra tekrar dene.' };
    const body = (await res.json().catch(() => ({}))) as {
      reply?: string;
      flagged?: boolean;
      error?: string;
      assistantDisabled?: boolean;
    };
    if (!res.ok) return { ok: false, error: body.error ?? 'Asistan yanıt veremedi', assistantDisabled: body.assistantDisabled };
    return { ok: true, reply: body.reply, flagged: body.flagged };
  }

  /* ---- Renderer'dan gelen sinyaller ---- */

  setEmotion(p: EmotionPayload): void {
    if (!this.settings?.cameraEnabled) return;
    this.riskState.emotion = p.faceDetected ? p.emotion : 'neutral';
    this.expressions = p.faceDetected ? p.expressions : {};
    this.recompute();
  }

  setAudioLevel(level: number): void {
    if (!this.settings?.micEnabled) return;
    this.audioLevel = level;
    this.riskState.audioRisk = audioRiskFromLevel(level);
    this.recompute();
  }

  /** Yalnızca geliştirme modunda: riskli durumu taklit eder. */
  devSimulate(kind: 'risk' | 'clear'): void {
    if (kind === 'risk') {
      this.riskState = { ...this.riskState, windowRisk: 85, windowTitle: 'Canlı bahis (test)', emotion: 'angry' };
    } else {
      this.riskState = { ...EMPTY_RISK_STATE };
    }
    this.recompute();
  }

  /* ---- Risk motoru ---- */

  private recompute(): void {
    const sens = this.settings?.sensitivity ?? 'medium';
    this.risk = computeRisk(this.riskState, sens);
    const now = Date.now();
    const threshold = SENSITIVITY_PROFILE[sens].eventThreshold;

    // Aynı durum için 60 sn bekleme; farklı bir riskli pencere/duygu ise (en fazla 5 sn arayla) hemen bildirilir.
    const alertKey = `${this.riskState.windowTitle}|${this.riskState.emotion}`;
    const wait = alertKey === this.lastAlertKey ? ALERT_COOLDOWN_MS : 5_000;
    if (this.running && this.risk >= threshold && now - this.lastAlert > wait) {
      this.lastAlert = now;
      this.lastAlertKey = alertKey;
      if (this.settings?.notifyParentOnRisk) {
        const event: AgentEvent = {
          occurredAt: now,
          title: `Anlık durum uyarısı (%${this.risk} risk)`,
          details: describeState(this.riskState),
          score: this.risk,
          category: riskCategory(this.riskState),
          windowTitle: this.settings.screenEnabled ? this.riskState.windowTitle.slice(0, 300) : '',
          emotion: this.riskState.emotion,
          source: 'risk',
        };
        void this.sendEvent(event).then((ok) => {
          if (!ok && this.store.get().deviceToken) this.queue.push(event);
        });
      }
    }

    if (this.running && this.risk >= GUIDANCE_THRESHOLD && now - this.lastGuidance > GUIDANCE_COOLDOWN_MS) {
      this.lastGuidance = now;
      const reasons = guidanceReasons(this.riskState);
      this.emit('guidance', {
        title: 'Kısa bir mola vermeye ne dersin?',
        description:
          reasons.length > 0
            ? `Şunu fark ettim: ${reasons.join(' • ')}. Derin bir nefes al, istersen bir yetişkinle konuş.`
            : 'Biraz yorulmuş görünüyorsun. Derin bir nefes al, istersen bir yetişkinle konuş.',
        score: this.risk,
      });
    }
    this.scheduleChange();
  }

  private scheduleChange(): void {
    if (this.notifyTimer) return;
    const t = setTimeout(() => {
      this.notifyTimer = null;
      this.emit('change');
    }, 400);
    this.notifyTimer = t as unknown as NodeJS.Timeout;
  }
}
