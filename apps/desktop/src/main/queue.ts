import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { AgentEvent } from '@dr/shared';
import { dataDir } from './store';

/** Sunucuya ulaşılamadığında olayları yerelde biriktirir. */
export class EventQueue {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(join(dataDir(), 'queue.db'));
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
  }

  push(event: AgentEvent): void {
    this.db.prepare('INSERT INTO queue (payload, created_at) VALUES (?, ?)').run(JSON.stringify(event), Date.now());
    // Sınırsız büyümeyi engelle.
    this.db.exec('DELETE FROM queue WHERE id NOT IN (SELECT id FROM queue ORDER BY id DESC LIMIT 500)');
  }

  peek(limit = 20): { id: number; event: AgentEvent }[] {
    const rows = this.db.prepare('SELECT id, payload FROM queue ORDER BY id LIMIT ?').all(limit) as { id: number; payload: string }[];
    return rows.map((r) => ({ id: Number(r.id), event: JSON.parse(r.payload) as AgentEvent }));
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM queue WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM queue');
  }

  close(): void {
    this.db.close();
  }
}
