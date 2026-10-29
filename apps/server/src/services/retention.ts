import { DEFAULT_SETTINGS } from '@dr/shared';
import type { Db } from '../db';

/** Her çocuğun saklama süresi (gün) ayarına göre eski verileri siler. */
export function runRetention(db: Db, now = Date.now()): number {
  const rows = db.all<{ child_id: string; json: string | null }>(
    `SELECT c.id AS child_id, s.json FROM children c LEFT JOIN settings s ON s.child_id = c.id`,
  );
  let removed = 0;
  for (const row of rows) {
    let days: number = DEFAULT_SETTINGS.retentionDays;
    try {
      if (row.json) days = JSON.parse(row.json).retentionDays ?? days;
    } catch {
      /* varsayılan */
    }
    const cutoff = now - days * 86_400_000;
    removed += db.run('DELETE FROM events WHERE child_id = ? AND occurred_at < ?', row.child_id, cutoff).changes;
    removed += db.run('DELETE FROM heartbeats WHERE child_id = ? AND ts < ?', row.child_id, cutoff).changes;
    removed += db.run('DELETE FROM chat_logs WHERE child_id = ? AND ts < ?', row.child_id, cutoff).changes;
  }
  db.run('DELETE FROM pairing_codes WHERE expires_at < ?', now);
  db.run('DELETE FROM refresh_tokens WHERE expires_at < ?', now - 86_400_000);
  db.run('DELETE FROM security_logs WHERE ts < ?', now - 180 * 86_400_000);
  return removed;
}
