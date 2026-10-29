import type { Db } from '../db';

export interface DaySummary {
  date: string;
  screenSeconds: number;
  events: number;
  maxRisk: number;
}

export interface Summary {
  days: number;
  screenSeconds: number;
  eventCount: number;
  avgRisk: number | null;
  maxRisk: number;
  emotionCounts: Record<string, number>;
  daily: DaySummary[];
}

function localDate(ts: number, tzOffsetMin: number): string {
  // tzOffsetMin: tarayıcıdaki Date.getTimezoneOffset() (UTC - yerel, dakika)
  return new Date(ts - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** Yalnızca gerçek nabız/olay verisinden hesaplanır; veri yoksa sıfır/null döner. */
export function buildSummary(db: Db, childId: string, days: number, tzOffsetMin = 0): Summary {
  const now = Date.now();
  const startDay = new Date(now - tzOffsetMin * 60_000);
  startDay.setUTCHours(0, 0, 0, 0);
  startDay.setUTCDate(startDay.getUTCDate() - (days - 1));
  const from = startDay.getTime() + tzOffsetMin * 60_000;

  const beats = db.all<{ ts: number; risk_score: number; emotion: string; active_seconds: number }>(
    'SELECT ts, risk_score, emotion, active_seconds FROM heartbeats WHERE child_id = ? AND ts >= ?',
    childId,
    from,
  );
  const events = db.all<{ occurred_at: number; score: number }>(
    'SELECT occurred_at, score FROM events WHERE child_id = ? AND occurred_at >= ?',
    childId,
    from,
  );

  const byDay = new Map<string, DaySummary>();
  for (let i = 0; i < days; i++) {
    const date = localDate(from + i * 86_400_000 + 3_600_000, tzOffsetMin);
    byDay.set(date, { date, screenSeconds: 0, events: 0, maxRisk: 0 });
  }
  const emotionCounts: Record<string, number> = {};
  let screenSeconds = 0;
  let riskSum = 0;
  let maxRisk = 0;
  for (const b of beats) {
    screenSeconds += b.active_seconds;
    riskSum += b.risk_score;
    maxRisk = Math.max(maxRisk, b.risk_score);
    emotionCounts[b.emotion] = (emotionCounts[b.emotion] ?? 0) + 1;
    const d = byDay.get(localDate(b.ts, tzOffsetMin));
    if (d) {
      d.screenSeconds += b.active_seconds;
      d.maxRisk = Math.max(d.maxRisk, b.risk_score);
    }
  }
  for (const e of events) {
    maxRisk = Math.max(maxRisk, e.score);
    const d = byDay.get(localDate(e.occurred_at, tzOffsetMin));
    if (d) {
      d.events += 1;
      d.maxRisk = Math.max(d.maxRisk, e.score);
    }
  }
  return {
    days,
    screenSeconds,
    eventCount: events.length,
    avgRisk: beats.length ? Math.round(riskSum / beats.length) : null,
    maxRisk,
    emotionCounts,
    daily: [...byDay.values()],
  };
}
