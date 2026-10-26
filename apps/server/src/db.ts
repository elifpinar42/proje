import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { join } from 'node:path';

type Param = SQLInputValue;

/** node:sqlite üzerine ince, tip dostu bir sarmalayıcı. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.raw.close();
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number };
    let version = Number(row.user_version);
    for (let i = version; i < MIGRATIONS.length; i++) {
      this.transaction(() => {
        this.raw.exec(MIGRATIONS[i]);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
      });
      version = i + 1;
    }
  }
}

export function openDb(dataDir: string): Db {
  return new Db(join(dataDir, 'dijital-rehberlik.db'));
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    totp_secret_enc TEXT,
    totp_pending_enc TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_recovery_user ON recovery_codes(user_id);
  CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE children (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_children_parent ON children(parent_id);
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen INTEGER
  );
  CREATE TABLE pairing_codes (
    code TEXT PRIMARY KEY,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
    json TEXT NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    occurred_at INTEGER NOT NULL,
    title TEXT NOT NULL,
    details TEXT NOT NULL,
    score INTEGER NOT NULL,
    category TEXT NOT NULL,
    window_title TEXT NOT NULL DEFAULT '',
    emotion TEXT NOT NULL DEFAULT 'neutral',
    source TEXT NOT NULL DEFAULT 'risk'
  );
  CREATE INDEX idx_events_child_time ON events(child_id, occurred_at);
  CREATE TABLE heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    risk_score INTEGER NOT NULL,
    emotion TEXT NOT NULL,
    window_title TEXT NOT NULL DEFAULT '',
    audio_level REAL NOT NULL DEFAULT 0,
    keyboard_risk REAL NOT NULL DEFAULT 0,
    active_seconds INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_hb_child_time ON heartbeats(child_id, ts);
  CREATE TABLE ai_config (
    parent_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'own_key' CHECK (mode IN ('own_key','managed')),
    enabled INTEGER NOT NULL DEFAULT 0,
    base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
    model TEXT NOT NULL DEFAULT '',
    api_key_enc TEXT
  );
  CREATE TABLE chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE INDEX idx_chat_child_time ON chat_logs(child_id, ts);
  CREATE TABLE security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_seclog_user ON security_logs(user_id, ts);
  `,
];
