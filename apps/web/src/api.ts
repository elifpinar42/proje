export interface User {
  id: string;
  username: string;
  role: 'parent';
  twoFactorEnabled: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<User | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(fn: () => void): void {
  onSessionLost = fn;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Yenileme çerezi ile yeni erişim jetonu alır (aynı anda tek istek). */
export function refreshSession(): Promise<User | null> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (res) => {
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = await res.json();
        accessToken = data.accessToken;
        return data.user as User;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const user = await refreshSession();
    if (user) return raw(path, init, false);
    onSessionLost?.();
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'İstek başarısız', data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => raw(path).then((r) => parse<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    raw(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => parse<T>(r)),
  put: <T>(path: string, body: unknown) =>
    raw(path, { method: 'PUT', body: JSON.stringify(body) }).then((r) => parse<T>(r)),
  del: <T>(path: string) => raw(path, { method: 'DELETE' }).then((r) => parse<T>(r)),
  async download(path: string, body: unknown, filename: string): Promise<void> {
    const res = await raw(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new ApiError(res.status, 'İndirme başarısız');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export interface LiveMessage {
  type: 'heartbeat' | 'event';
  data: Record<string, unknown>;
}

/** Canlı akışa (SSE) bağlanır; kopunca kendiliğinden yeniden dener. Dönen fonksiyon bağlantıyı kapatır. */
export function subscribeLive(onMessage: (m: LiveMessage) => void, onState?: (connected: boolean) => void): () => void {
  const ctrl = new AbortController();
  (async () => {
    while (!ctrl.signal.aborted) {
      try {
        const res = await raw('/stream', { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
        if (!res.ok || !res.body) throw new Error('stream');
        onState?.(true);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const type = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (type && data) onMessage({ type: type as LiveMessage['type'], data: JSON.parse(data) });
          }
        }
      } catch {
        /* yeniden dene */
      }
      onState?.(false);
      if (!ctrl.signal.aborted) await new Promise((r) => setTimeout(r, 3000));
    }
  })();
  return () => ctrl.abort();
}

/* ---- Tipler ---- */

export interface Child {
  id: string;
  name: string;
  createdAt: number;
  deviceCount: number;
}
export interface Status {
  childId: string;
  deviceCount: number;
  lastSeen: number | null;
  online: boolean;
  riskScore: number;
  emotion: string;
  windowTitle: string;
  audioLevel: number;
  keyboardRisk: number;
}
export interface EventItem {
  id: number;
  occurredAt: number;
  title: string;
  details: string;
  score: number;
  category: string;
  windowTitle: string;
  emotion: string;
  source: 'risk' | 'chat';
}
export interface Summary {
  days: number;
  screenSeconds: number;
  eventCount: number;
  avgRisk: number | null;
  maxRisk: number;
  emotionCounts: Record<string, number>;
  daily: { date: string; screenSeconds: number; events: number; maxRisk: number }[];
}
