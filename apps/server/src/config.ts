import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export interface ServerOptions {
  /** Veritabanı ve gizli anahtarların saklanacağı klasör. */
  dataDir: string;
  host?: string;
  port?: number;
  /** Derlenmiş ebeveyn paneli (apps/web/dist). Yoksa yalnızca API sunulur. */
  webDir?: string;
  /** PDF için DejaVu Sans yazı tiplerinin klasörü. */
  fontsDir?: string;
  /** Tarayıcıdan farklı bir origin'den erişime izin verilen adresler. */
  allowedOrigins?: string[];
  /** Hız sınırlamayı kapatır (yalnızca testler için). */
  disableRateLimit?: boolean;
  /** Çerezleri yalnızca HTTPS üzerinden gönder (HTTPS arkasında true yapın). */
  secureCookies?: boolean;
  /** Ters vekil (nginx, Caddy) arkasında çalışırken true. */
  trustProxy?: boolean;
  /** Yeni ebeveyn hesabı açılmasına izin ver. */
  allowRegistration?: boolean;
}

export interface ServerConfig extends Required<Omit<ServerOptions, 'webDir' | 'fontsDir'>> {
  webDir: string | null;
  fontsDir: string | null;
  jwtSecret: string;
  encryptionKey: Buffer;
}

interface StoredSecrets {
  jwtSecret: string;
  encryptionKey: string;
}

/** Anahtarlar env'de verilmediyse ilk açılışta rastgele üretilip veri klasörüne yazılır. */
function loadSecrets(dataDir: string): StoredSecrets {
  const file = join(dataDir, 'secrets.json');
  let stored: Partial<StoredSecrets> = {};
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      stored = {};
    }
  }
  const jwtSecret = process.env.JWT_SECRET || stored.jwtSecret || randomBytes(48).toString('hex');
  const encryptionKey =
    process.env.ENCRYPTION_KEY || stored.encryptionKey || randomBytes(32).toString('hex');
  if (stored.jwtSecret !== jwtSecret || stored.encryptionKey !== encryptionKey) {
    if (!process.env.JWT_SECRET && !process.env.ENCRYPTION_KEY) {
      writeFileSync(file, JSON.stringify({ jwtSecret, encryptionKey }, null, 2), { mode: 0o600 });
    }
  }
  return { jwtSecret, encryptionKey };
}

export function resolveConfig(opts: ServerOptions): ServerConfig {
  const dataDir = resolve(opts.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const secrets = loadSecrets(dataDir);
  const key = Buffer.from(secrets.encryptionKey, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY 64 haneli hex (32 bayt) olmalı');
  return {
    dataDir,
    host: opts.host ?? '127.0.0.1',
    port: opts.port ?? 3000,
    webDir: opts.webDir && existsSync(opts.webDir) ? resolve(opts.webDir) : null,
    fontsDir: opts.fontsDir && existsSync(opts.fontsDir) ? resolve(opts.fontsDir) : null,
    allowedOrigins: opts.allowedOrigins ?? [],
    disableRateLimit: opts.disableRateLimit ?? false,
    secureCookies: opts.secureCookies ?? false,
    trustProxy: opts.trustProxy ?? false,
    allowRegistration: opts.allowRegistration ?? true,
    jwtSecret: secrets.jwtSecret,
    encryptionKey: key,
  };
}
