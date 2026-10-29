import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  chatSchema,
  checkChildMessage,
  eventSchema,
  heartbeatSchema,
  pairSchema,
  unpairSchema,
} from '@dr/shared';
import { type AppContext, HttpError, logSecurity, requireDevice } from '../context';
import { newId, randomToken, sha256 } from '../security';
import { CHILD_SYSTEM_PROMPT, isAiEnabled, providerFor } from '../services/ai';
import { loadSettings } from './parent';

/** Çocuk cihazındaki masaüstü ajanının kullandığı uç noktalar (cihaz jetonlu). */
export function agentRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, hub, config } = ctx;

  const pairLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.disableRateLimit ? 100000 : 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' },
  });

  r.post('/pair', pairLimiter, (req, res) => {
    const body = pairSchema.parse(req.body);
    const row = db.get<{ child_id: string; expires_at: number }>(
      'SELECT child_id, expires_at FROM pairing_codes WHERE code = ?',
      body.code,
    );
    if (!row || row.expires_at < Date.now()) {
      throw new HttpError(400, 'Kod geçersiz veya süresi dolmuş');
    }
    const token = `drd_${randomToken(32)}`;
    const deviceId = newId();
    db.transaction(() => {
      db.run('DELETE FROM pairing_codes WHERE code = ?', body.code);
      db.run(
        'INSERT INTO devices (id, child_id, name, token_hash, created_at) VALUES (?,?,?,?,?)',
        deviceId,
        row.child_id,
        body.deviceName,
        sha256(token),
        Date.now(),
      );
    });
    const child = db.get<{ name: string }>('SELECT name FROM children WHERE id = ?', row.child_id)!;
    res.status(201).json({
      deviceToken: token,
      deviceId,
      childId: row.child_id,
      childName: child.name,
      settings: loadSettings(ctx, row.child_id),
    });
  });

  r.use(requireDevice(ctx));

  /** Çocuk cihazı eşleşmeyi yalnızca ebeveynin verdiği kodla kaldırabilir. */
  r.post('/unpair', pairLimiter, (req, res) => {
    const { childId, parentId, id } = req.device!;
    const { code } = unpairSchema.parse(req.body);
    const row = db.get<{ expires_at: number }>(
      'SELECT expires_at FROM unpair_codes WHERE code = ? AND child_id = ?',
      code,
      childId,
    );
    if (!row || row.expires_at < Date.now()) throw new HttpError(403, 'Kod geçersiz veya süresi dolmuş');
    db.transaction(() => {
      db.run('DELETE FROM unpair_codes WHERE child_id = ?', childId);
      db.run('DELETE FROM devices WHERE id = ?', id);
    });
    logSecurity(ctx, req, parentId, 'device_unpaired_with_code');
    res.json({ ok: true });
  });

  r.get('/settings', (req, res) => {
    const { childId, parentId } = req.device!;
    const child = db.get<{ name: string }>('SELECT name FROM children WHERE id = ?', childId)!;
    res.json({
      childName: child.name,
      settings: loadSettings(ctx, childId),
      aiEnabled: isAiEnabled(db, parentId),
      serverTime: Date.now(),
    });
  });

  r.post('/events', (req, res) => {
    const { childId, parentId } = req.device!;
    const e = eventSchema.parse(req.body);
    const occurredAt = e.occurredAt ?? Date.now();
    const result = db.raw
      .prepare(
        `INSERT INTO events (child_id, occurred_at, title, details, score, category, window_title, emotion, source)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(childId, occurredAt, e.title, e.details, e.score, e.category, e.windowTitle, e.emotion, e.source);
    hub.publish(parentId, 'event', { childId, id: Number(result.lastInsertRowid), occurredAt, ...e });
    res.status(201).json({ ok: true });
  });

  r.post('/heartbeat', (req, res) => {
    const { childId, parentId } = req.device!;
    const h = heartbeatSchema.parse(req.body);
    const ts = Date.now();
    db.run(
      `INSERT INTO heartbeats (child_id, ts, risk_score, emotion, window_title, audio_level, keyboard_risk, active_seconds)
       VALUES (?,?,?,?,?,?,?,?)`,
      childId,
      ts,
      h.riskScore,
      h.emotion,
      h.windowTitle,
      h.audioLevel,
      h.keyboardRisk,
      h.activeSeconds,
    );
    hub.publish(parentId, 'heartbeat', { childId, ts, ...h });
    res.json({ ok: true, settings: loadSettings(ctx, childId) });
  });

  r.post('/chat', async (req, res) => {
    const { childId, parentId } = req.device!;
    const body = chatSchema.parse(req.body);
    const now = Date.now();
    db.run('INSERT INTO chat_logs (child_id, ts, role, content) VALUES (?,?,?,?)', childId, now, 'user', body.message);

    // Güvenlik filtresi AI'dan bağımsızdır: tehlike/kişisel bilgi ebeveyne olay olarak düşer.
    const hit = checkChildMessage(body.message);
    if (hit) {
      const score = hit.severity === 'critical' ? 90 : 65;
      const details = `Sohbet mesajında "${hit.category}" tespit edildi: "${body.message.slice(0, 200)}"`;
      const title = `Sohbet güvenlik uyarısı: ${hit.category}`;
      const result = db.raw
        .prepare(
          `INSERT INTO events (child_id, occurred_at, title, details, score, category, window_title, emotion, source)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(childId, now, title, details, score, hit.category, '', 'neutral', 'chat');
      hub.publish(parentId, 'event', {
        childId,
        id: Number(result.lastInsertRowid),
        occurredAt: now,
        title,
        details,
        score,
        category: hit.category,
        windowTitle: '',
        emotion: 'neutral',
        source: 'chat',
      });
      db.run('INSERT INTO chat_logs (child_id, ts, role, content) VALUES (?,?,?,?)', childId, Date.now(), 'assistant', hit.response);
      res.json({ reply: hit.response, flagged: true });
      return;
    }

    const provider = providerFor(db, parentId, config.encryptionKey);
    if (!provider) throw new HttpError(503, 'Asistan şu anda kapalı', { assistantDisabled: true });
    try {
      const reply = await provider.chat([
        { role: 'system', content: CHILD_SYSTEM_PROMPT },
        ...body.history,
        { role: 'user', content: body.message },
      ]);
      db.run('INSERT INTO chat_logs (child_id, ts, role, content) VALUES (?,?,?,?)', childId, Date.now(), 'assistant', reply);
      res.json({ reply, flagged: false });
    } catch (e) {
      console.warn('[ai] çağrı başarısız:', e instanceof Error ? e.message : e);
      throw new HttpError(502, 'Asistan şu anda yanıt veremiyor. Biraz sonra tekrar dene.');
    }
  });

  return r;
}
