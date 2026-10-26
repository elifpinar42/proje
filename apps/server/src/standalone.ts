import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app';

const here = dirname(fileURLToPath(import.meta.url));
const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const bool = (v: string | undefined, def: boolean) =>
  v === undefined ? def : ['1', 'true', 'yes'].includes(v.toLowerCase());

function firstExisting(...paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

const server = createServer({
  dataDir: process.env.DATA_DIR ?? join(process.cwd(), '.data'),
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
  webDir:
    process.env.WEB_DIR ??
    firstExisting(join(here, 'web'), join(here, '../../web/dist'), join(process.cwd(), 'apps/web/dist')),
  fontsDir:
    process.env.FONTS_DIR ??
    firstExisting(join(here, 'fonts'), join(here, '../fonts'), join(process.cwd(), 'apps/server/fonts')),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  secureCookies: bool(process.env.SECURE_COOKIES, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  allowRegistration: bool(process.env.ALLOW_REGISTRATION, true),
});

server
  .start()
  .then(({ host, port }) => {
    console.log(`Dijital Rehberlik sunucusu dinliyor: http://${host}:${port}`);
    if (!server.config.webDir) console.log('Uyarı: ebeveyn paneli (apps/web/dist) bulunamadı; yalnızca API sunuluyor.');
  })
  .catch((err) => {
    console.error('Sunucu başlatılamadı:', err);
    process.exit(1);
  });

const shutdown = () => {
  server.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
