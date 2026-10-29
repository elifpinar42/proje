import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { EMOTION_LABELS, type Emotion } from '@dr/shared';
import { api, ApiError } from './api';
import { useSession } from './session';

export function riskColor(score: number): string {
  if (score >= 60) return 'var(--danger)';
  if (score >= 35) return 'var(--warn)';
  return 'var(--ok)';
}

export function RiskBar({ score }: { score: number }) {
  return (
    <div className="risk-bar" role="progressbar" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Risk puanı">
      <div style={{ width: `${score}%`, background: riskColor(score) }} />
    </div>
  );
}

export function emotionLabel(e: string): string {
  return EMOTION_LABELS[e as Emotion] ?? e;
}

export function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

export function fmtTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export function errMsg(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : 'Bir hata oluştu';
}

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <header className="row between">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

/** Çocuk seçici + çocuk yoksa yönlendirme. */
export function ChildPicker() {
  const { children, childId, setChildId } = useSession();
  if (children.length <= 1) return children[0] ? <span className="badge">{children[0].name}</span> : null;
  return (
    <select aria-label="Çocuk seç" value={childId ?? ''} onChange={(e) => setChildId(e.target.value)} style={{ width: 'auto' }}>
      {children.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function NoChild() {
  return (
    <div className="card stack">
      <h2>Henüz çocuk profili yok</h2>
      <p className="muted">Başlamak için “Çocuklar” sayfasından bir profil oluşturup cihazı eşleştirin.</p>
    </div>
  );
}

/** Basit veri yükleyici. */
export function useLoad<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string; reload(): void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api
      .get<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [path, tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
