import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StoredConfig {
  serverMode: 'embedded' | 'remote';
  serverUrl: string;
  deviceToken: string | null;
  childName: string;
  consentAccepted: boolean;
}

const DEFAULTS: StoredConfig = {
  serverMode: 'embedded',
  serverUrl: '',
  deviceToken: null,
  childName: '',
  consentAccepted: false,
};

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class Store {
  private file = join(dataDir(), 'config.json');
  private cfg: StoredConfig;

  constructor() {
    let loaded: Partial<StoredConfig> = {};
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        loaded = {};
      }
    }
    this.cfg = { ...DEFAULTS, ...loaded };
  }

  get(): StoredConfig {
    return this.cfg;
  }

  update(patch: Partial<StoredConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
