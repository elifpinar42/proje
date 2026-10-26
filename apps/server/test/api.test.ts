import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type RunningServer } from '../src/index';
import { totpAt } from '../src/security';

let srv: RunningServer;
let dir: string;
const agent = () => request(srv.app);

async function register(username: string, password = 'Parola123') {
  const res = await agent().post('/api/auth/register').send({ username, password });
  return res;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dr-test-'));
  srv = createServer({
    dataDir: dir,
    disableRateLimit: true,
    fontsDir: join(process.cwd(), 'apps/server/fonts'),
  });
});

afterAll(async () => {
  await srv.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('sağlık', () => {
  it('/api/health 200 döner', async () => {
    const res = await agent().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('kimlik doğrulama', () => {
  it('kayıt → giriş → korumalı uç nokta (403 hatası yok) ve rol refresh sonrası korunur', async () => {
    const reg = await register('ayse');
    expect(reg.status).toBe(201);
    expect(reg.body.recoveryCodes).toHaveLength(8);
    expect(reg.body.user.role).toBe('parent');

    const login = await agent().post('/api/auth/login').send({ username: 'ayse', password: 'Parola123' });
    expect(login.status).toBe(200);
    const children = await agent().get('/api/children').set(auth(login.body.accessToken));
    expect(children.status).toBe(200);

    const cookie = login.headers['set-cookie'];
    const refreshed = await agent().post('/api/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe('parent');
    const again = await agent().get('/api/children').set(auth(refreshed.body.accessToken));
    expect(again.status).toBe(200);
  });

  it('yanlış şifre 401, jetonsuz istek 401', async () => {
    const bad = await agent().post('/api/auth/login').send({ username: 'ayse', password: 'yanlis123' });
    expect(bad.status).toBe(401);
    expect((await agent().get('/api/children')).status).toBe(401);
  });

  it('zayıf şifre reddedilir', async () => {
    const res = await register('zayif', 'abc');
    expect(res.status).toBe(400);
  });

  it('kullanılmış yenileme jetonu tüm oturumları kapatır', async () => {
    const reg = await register('mehmet');
    const cookie = reg.headers['set-cookie'];
    const first = await agent().post('/api/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    const reuse = await agent().post('/api/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
    const dead = await agent().get('/api/children').set(auth(first.body.accessToken));
    expect(dead.status).toBe(401);
  });

  it('kurtarma kodu ile şifre sıfırlanır ve kod tek kullanımlıktır', async () => {
    const reg = await register('fatma');
    const code = reg.body.recoveryCodes[0];
    const ok = await agent()
      .post('/api/auth/recover')
      .send({ username: 'fatma', recoveryCode: code, newPassword: 'YeniParola9' });
    expect(ok.status).toBe(200);
    const again = await agent()
      .post('/api/auth/recover')
      .send({ username: 'fatma', recoveryCode: code, newPassword: 'BaskaParola9' });
    expect(again.status).toBe(400);
    const login = await agent().post('/api/auth/login').send({ username: 'fatma', password: 'YeniParola9' });
    expect(login.status).toBe(200);
  });

  it('2FA kurulumu ve girişte kod zorunluluğu', async () => {
    const reg = await register('veli');
    const token = reg.body.accessToken;
    const setup = await agent().post('/api/auth/2fa/setup').set(auth(token));
    expect(setup.status).toBe(200);
    const code = totpAt(setup.body.secret, Date.now());
    expect((await agent().post('/api/auth/2fa/enable').set(auth(token)).send({ token: code })).status).toBe(200);

    const noCode = await agent().post('/api/auth/login').send({ username: 'veli', password: 'Parola123' });
    expect(noCode.status).toBe(401);
    expect(noCode.body.totpRequired).toBe(true);
    const withCode = await agent()
      .post('/api/auth/login')
      .send({ username: 'veli', password: 'Parola123', totp: totpAt(setup.body.secret, Date.now()) });
    expect(withCode.status).toBe(200);
  });
});

describe('sahiplik (IDOR)', () => {
  it('başka ebeveynin çocuğu 404 döner', async () => {
    const a = await register('ebeveyn-a');
    const b = await register('ebeveyn-b');
    const child = await agent().post('/api/children').set(auth(a.body.accessToken)).send({ name: 'Ali' });
    expect(child.status).toBe(201);
    const id = child.body.id;
    for (const path of [`/api/children/${id}/events`, `/api/children/${id}/settings`, `/api/children/${id}/status`, `/api/children/${id}/summary`]) {
      expect((await agent().get(path).set(auth(b.body.accessToken))).status).toBe(404);
    }
    expect((await agent().delete(`/api/children/${id}`).set(auth(b.body.accessToken))).status).toBe(404);
    const pdf = await agent().post('/api/reports/pdf').set(auth(b.body.accessToken)).send({ childId: id, days: 7 });
    expect(pdf.status).toBe(404);
  });

  it('cihaz jetonu ebeveyn uç noktalarına erişemez', async () => {
    const a = await register('ebeveyn-c');
    const child = await agent().post('/api/children').set(auth(a.body.accessToken)).send({ name: 'Zeynep' });
    const code = await agent().post(`/api/children/${child.body.id}/pairing-code`).set(auth(a.body.accessToken));
    const pair = await agent().post('/api/agent/pair').send({ code: code.body.code, deviceName: 'PC' });
    expect(pair.status).toBe(201);
    const res = await agent().get('/api/children').set(auth(pair.body.deviceToken));
    expect(res.status).toBe(401);
  });
});

describe('eşleştirme ve ajan akışı', () => {
  it('kod ile eşleş → ayarlar → olay/nabız → ebeveyn görür → PDF', async () => {
    const p = await register('akis-ebeveyn');
    const token = p.body.accessToken;
    const child = await agent().post('/api/children').set(auth(token)).send({ name: 'Elif' });
    const code = await agent().post(`/api/children/${child.body.id}/pairing-code`).set(auth(token));
    expect(code.body.code).toMatch(/^\d{6}$/);

    const pair = await agent().post('/api/agent/pair').send({ code: code.body.code, deviceName: 'Elif PC' });
    expect(pair.status).toBe(201);
    const dev = auth(pair.body.deviceToken);
    // kod tek kullanımlık
    expect((await agent().post('/api/agent/pair').send({ code: code.body.code })).status).toBe(400);

    const st = await agent().get('/api/agent/settings').set(dev);
    expect(st.body.childName).toBe('Elif');
    expect(st.body.aiEnabled).toBe(false);

    const ev = await agent().post('/api/agent/events').set(dev).send({
      title: 'Uyarı',
      details: 'Kumar sitesi',
      score: 85,
      category: 'Sakıncalı İçerik / Sayfa',
      windowTitle: 'Canlı bahis',
      emotion: 'neutral',
    });
    expect(ev.status).toBe(201);
    for (let i = 0; i < 3; i++) {
      await agent().post('/api/agent/heartbeat').set(dev).send({ riskScore: 20, emotion: 'sad', windowTitle: 'Word', activeSeconds: 10 });
    }

    const events = await agent().get(`/api/children/${child.body.id}/events?minScore=60`).set(auth(token));
    expect(events.body.total).toBe(1);
    expect(events.body.items[0].category).toBe('Sakıncalı İçerik / Sayfa');

    const status = await agent().get(`/api/children/${child.body.id}/status`).set(auth(token));
    expect(status.body.online).toBe(true);
    expect(status.body.emotion).toBe('sad');

    const summary = await agent().get(`/api/children/${child.body.id}/summary?days=1`).set(auth(token));
    expect(summary.body.screenSeconds).toBe(30);
    expect(summary.body.eventCount).toBe(1);
    expect(summary.body.emotionCounts.sad).toBe(3);

    const pdf = await agent()
      .post('/api/reports/pdf')
      .set(auth(token))
      .send({ childId: child.body.id, days: 7 })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('cihaz kaldırılınca jeton geçersiz olur', async () => {
    const p = await register('akis2');
    const token = p.body.accessToken;
    const child = await agent().post('/api/children').set(auth(token)).send({ name: 'Can' });
    const code = await agent().post(`/api/children/${child.body.id}/pairing-code`).set(auth(token));
    const pair = await agent().post('/api/agent/pair').send({ code: code.body.code });
    await agent().delete(`/api/devices/${pair.body.deviceId}`).set(auth(token)).expect(200);
    expect((await agent().get('/api/agent/settings').set(auth(pair.body.deviceToken))).status).toBe(401);
  });
});

describe('eşleşmeyi kaldırma kodu', () => {
  it('çocuk cihazı yalnızca ebeveynin kodu ile eşleşmeyi kaldırabilir', async () => {
    const p = await register('kaldir-ebeveyn');
    const token = p.body.accessToken;
    const child = await agent().post('/api/children').set(auth(token)).send({ name: 'Ayşe' });
    const code = await agent().post(`/api/children/${child.body.id}/pairing-code`).set(auth(token));
    const pair = await agent().post('/api/agent/pair').send({ code: code.body.code });
    const dev = auth(pair.body.deviceToken);

    expect((await agent().post('/api/agent/unpair').set(dev).send({ code: '123456' })).status).toBe(403);
    expect((await agent().get('/api/agent/settings').set(dev)).status).toBe(200);

    const un = await agent().post(`/api/children/${child.body.id}/unpair-code`).set(auth(token));
    expect(un.body.code).toMatch(/^\d{6}$/);
    expect((await agent().post('/api/agent/unpair').set(dev).send({ code: un.body.code })).status).toBe(200);
    expect((await agent().get('/api/agent/settings').set(dev)).status).toBe(401);
  });

  it('başka ebeveyn kaldırma kodu üretemez; ayarlarda autostart varsayılan açık', async () => {
    const a = await register('kaldir-a');
    const b = await register('kaldir-b');
    const child = await agent().post('/api/children').set(auth(a.body.accessToken)).send({ name: 'Mert' });
    expect((await agent().post(`/api/children/${child.body.id}/unpair-code`).set(auth(b.body.accessToken))).status).toBe(404);
    const st = await agent().get(`/api/children/${child.body.id}/settings`).set(auth(a.body.accessToken));
    expect(st.body.autostart).toBe(true);
    const info = await agent().get('/api/server-info').set(auth(a.body.accessToken));
    expect(info.status).toBe(200);
    expect(Array.isArray(info.body.lanUrls)).toBe(true);
  });
});

describe('sohbet güvenlik filtresi ve AI ayarları', () => {
  it('AI kapalıyken sohbet 503; tehlikeli mesaj ebeveyne olay düşer', async () => {
    const p = await register('sohbet-ebeveyn');
    const token = p.body.accessToken;
    const child = await agent().post('/api/children').set(auth(token)).send({ name: 'Deniz' });
    const code = await agent().post(`/api/children/${child.body.id}/pairing-code`).set(auth(token));
    const pair = await agent().post('/api/agent/pair').send({ code: code.body.code });
    const dev = auth(pair.body.deviceToken);

    const off = await agent().post('/api/agent/chat').set(dev).send({ message: 'gökyüzü neden mavi?' });
    expect(off.status).toBe(503);

    const flagged = await agent().post('/api/agent/chat').set(dev).send({ message: 'Bana şifreni ver diyor biri, şifremi verdim' });
    expect(flagged.status).toBe(200);
    expect(flagged.body.flagged).toBe(true);
    const events = await agent().get(`/api/children/${child.body.id}/events?source=chat`).set(auth(token));
    expect(events.body.total).toBe(1);
  });

  it('AI anahtarı hiçbir yanıtta geri dönmez', async () => {
    const p = await register('ai-ebeveyn');
    const token = p.body.accessToken;
    const put = await agent()
      .put('/api/ai/config')
      .set(auth(token))
      .send({ enabled: true, baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'sk-cok-gizli-123' });
    expect(put.status).toBe(200);
    expect(put.body.hasKey).toBe(true);
    expect(JSON.stringify(put.body)).not.toContain('cok-gizli');
    const get = await agent().get('/api/ai/config').set(auth(token));
    expect(JSON.stringify(get.body)).not.toContain('cok-gizli');
    // anahtar boş bırakılınca korunur
    const keep = await agent()
      .put('/api/ai/config')
      .set(auth(token))
      .send({ enabled: true, baseUrl: 'http://127.0.0.1:9/v1', model: 'm2' });
    expect(keep.body.hasKey).toBe(true);
    const row = srv.db.get<{ api_key_enc: string }>('SELECT api_key_enc FROM ai_config WHERE parent_id = ?', p.body.user.id);
    expect(row!.api_key_enc).not.toContain('cok-gizli');
  });
});
