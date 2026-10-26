import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  aiConfigSchema,
  childCreateSchema,
  pdfRequestSchema,
  settingsSchema,
  type ChildSettings,
} from '@dr/shared';
import {
  type AppContext,
  HttpError,
  logSecurity,
  ownedChild,
  requireParent,
} from '../context';
import { decrypt, encrypt, newId, sixDigitCode } from '../security';
import { buildSummary } from '../services/stats';
import { buildReportPdf } from '../services/pdf';
import { UserKeyProvider, getAiConfig, isAiEnabled } from '../services/ai';

const ONLINE_WINDOW_MS = 30_000;

export function loadSettings(ctx: AppContext, childId: string): ChildSettings {
  const row = ctx.db.get<{ json: string }>('SELECT json FROM settings WHERE child_id = ?', childId);
  if (!row) return DEFAULT_SETTINGS;
  try {
    return settingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(row.json) });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function parentRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, config, hub } = ctx;
  r.use(requireParent(ctx));

  /* ---- Çocuklar ---- */

  r.get('/children', (req, res) => {
    const rows = db.all<{ id: string; name: string; created_at: number; devices: number }>(
      `SELECT c.id, c.name, c.created_at,
        (SELECT COUNT(*) FROM devices d WHERE d.child_id = c.id) AS devices
       FROM children c WHERE c.parent_id = ? ORDER BY c.created_at`,
      req.parent!.id,
    );
    res.json({
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.created_at,
        deviceCount: Number(c.devices),
      })),
    });
  });

  r.post('/children', (req, res) => {
    const { name } = childCreateSchema.parse(req.body);
    const id = newId();
    db.transaction(() => {
      db.run('INSERT INTO children (id, parent_id, name, created_at) VALUES (?,?,?,?)', id, req.parent!.id, name, Date.now());
      db.run('INSERT INTO settings (child_id, json) VALUES (?,?)', id, JSON.stringify(DEFAULT_SETTINGS));
    });
    res.status(201).json({ id, name });
  });

  r.delete('/children/:id', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    db.run('DELETE FROM children WHERE id = ?', child.id);
    logSecurity(ctx, req, req.parent!.id, 'child_deleted', child.name);
    res.json({ ok: true });
  });

  r.delete('/children/:id/data', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    db.transaction(() => {
      db.run('DELETE FROM events WHERE child_id = ?', child.id);
      db.run('DELETE FROM heartbeats WHERE child_id = ?', child.id);
      db.run('DELETE FROM chat_logs WHERE child_id = ?', child.id);
    });
    logSecurity(ctx, req, req.parent!.id, 'child_data_deleted', child.name);
    res.json({ ok: true });
  });

  /* ---- Eşleştirme ve cihazlar ---- */

  r.post('/children/:id/pairing-code', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const expiresAt = Date.now() + 10 * 60_000;
    db.run('DELETE FROM pairing_codes WHERE child_id = ?', child.id);
    let code = sixDigitCode();
    while (db.get('SELECT 1 AS x FROM pairing_codes WHERE code = ?', code)) code = sixDigitCode();
    db.run('INSERT INTO pairing_codes (code, child_id, expires_at) VALUES (?,?,?)', code, child.id, expiresAt);
    res.status(201).json({ code, expiresAt });
  });

  r.get('/children/:id/devices', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const rows = db.all<{ id: string; name: string; created_at: number; last_seen: number | null }>(
      'SELECT id, name, created_at, last_seen FROM devices WHERE child_id = ? ORDER BY created_at',
      child.id,
    );
    res.json({
      items: rows.map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeen: d.last_seen })),
    });
  });

  r.delete('/devices/:id', (req, res) => {
    const result = db.run(
      `DELETE FROM devices WHERE id = ? AND child_id IN (SELECT id FROM children WHERE parent_id = ?)`,
      String(req.params.id),
      req.parent!.id,
    );
    if (!result.changes) throw new HttpError(404, 'Cihaz bulunamadı');
    logSecurity(ctx, req, req.parent!.id, 'device_removed');
    res.json({ ok: true });
  });

  /* ---- Ayarlar ---- */

  r.get('/children/:id/settings', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    res.json(loadSettings(ctx, child.id));
  });

  r.put('/children/:id/settings', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const settings = settingsSchema.parse(req.body);
    db.run(
      `INSERT INTO settings (child_id, json) VALUES (?,?)
       ON CONFLICT(child_id) DO UPDATE SET json = excluded.json`,
      child.id,
      JSON.stringify(settings),
    );
    res.json(settings);
  });

  /* ---- Canlı durum, geçmiş, özet ---- */

  r.get('/children/:id/status', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const hb = db.get<{
      ts: number;
      risk_score: number;
      emotion: string;
      window_title: string;
      audio_level: number;
      keyboard_risk: number;
    }>('SELECT * FROM heartbeats WHERE child_id = ? ORDER BY ts DESC LIMIT 1', child.id);
    const devices = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM devices WHERE child_id = ?', child.id)!;
    res.json({
      childId: child.id,
      deviceCount: Number(devices.n),
      lastSeen: hb?.ts ?? null,
      online: !!hb && Date.now() - hb.ts < ONLINE_WINDOW_MS,
      riskScore: hb?.risk_score ?? 0,
      emotion: hb?.emotion ?? 'neutral',
      windowTitle: hb?.window_title ?? '',
      audioLevel: hb?.audio_level ?? 0,
      keyboardRisk: hb?.keyboard_risk ?? 0,
    });
  });

  const listQuery = z.object({
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    minScore: z.coerce.number().int().min(0).max(100).default(0),
    source: z.enum(['risk', 'chat']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  r.get('/children/:id/events', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const q = listQuery.parse(req.query);
    const where = ['child_id = ?', 'score >= ?', 'occurred_at >= ?', 'occurred_at <= ?'];
    const params: (string | number)[] = [child.id, q.minScore, q.from ?? 0, q.to ?? Number.MAX_SAFE_INTEGER];
    if (q.source) {
      where.push('source = ?');
      params.push(q.source);
    }
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE ${where.join(' AND ')}`, ...params)!;
    const rows = db.all<{
      id: number;
      occurred_at: number;
      title: string;
      details: string;
      score: number;
      category: string;
      window_title: string;
      emotion: string;
      source: string;
    }>(
      `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
      ...params,
      q.limit,
      q.offset,
    );
    res.json({
      total: Number(total.n),
      items: rows.map((e) => ({
        id: e.id,
        occurredAt: e.occurred_at,
        title: e.title,
        details: e.details,
        score: e.score,
        category: e.category,
        windowTitle: e.window_title,
        emotion: e.emotion,
        source: e.source,
      })),
    });
  });

  r.get('/children/:id/summary', (req, res) => {
    const child = ownedChild(ctx, req, String(req.params.id));
    const q = z
      .object({
        days: z.coerce.number().int().min(1).max(90).default(1),
        tz: z.coerce.number().int().min(-840).max(840).default(0),
      })
      .parse(req.query);
    res.json(buildSummary(db, child.id, q.days, q.tz));
  });

  /** Canlı akış (SSE). İstemci fetch + Authorization başlığıyla bağlanır. */
  r.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const remove = hub.add(req.parent!.id, res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      remove();
    });
  });

  /* ---- PDF ---- */

  r.post('/reports/pdf', async (req, res) => {
    const body = pdfRequestSchema.parse(req.body);
    const tz = z.coerce.number().int().min(-840).max(840).default(0).parse(req.query.tz);
    const child = ownedChild(ctx, req, body.childId);
    const pdf = await buildReportPdf(db, config.fontsDir, child, body.days, tz);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rapor-${child.id}.pdf"`,
    });
    res.send(pdf);
  });

  /* ---- AI ayarları ---- */

  const publicAi = (parentId: string) => {
    const c = getAiConfig(db, parentId);
    return {
      mode: 'own_key' as const,
      enabled: !!c && isAiEnabled(db, parentId),
      baseUrl: c?.base_url ?? 'https://api.openai.com/v1',
      model: c?.model ?? '',
      hasKey: !!c?.api_key_enc,
    };
  };

  r.get('/ai/config', (req, res) => {
    res.json(publicAi(req.parent!.id));
  });

  r.put('/ai/config', (req, res) => {
    const body = aiConfigSchema.parse(req.body);
    if (!/^https?:\/\//.test(body.baseUrl)) throw new HttpError(400, 'Adres http veya https ile başlamalı');
    const existing = getAiConfig(db, req.parent!.id);
    const keyEnc = body.apiKey ? encrypt(body.apiKey, config.encryptionKey) : (existing?.api_key_enc ?? null);
    db.run(
      `INSERT INTO ai_config (parent_id, mode, enabled, base_url, model, api_key_enc)
       VALUES (?, 'own_key', ?, ?, ?, ?)
       ON CONFLICT(parent_id) DO UPDATE SET enabled = excluded.enabled, base_url = excluded.base_url,
         model = excluded.model, api_key_enc = excluded.api_key_enc`,
      req.parent!.id,
      body.enabled ? 1 : 0,
      body.baseUrl,
      body.model,
      keyEnc,
    );
    logSecurity(ctx, req, req.parent!.id, 'ai_config_updated');
    res.json(publicAi(req.parent!.id));
  });

  r.delete('/ai/config/key', (req, res) => {
    db.run('UPDATE ai_config SET api_key_enc = NULL, enabled = 0 WHERE parent_id = ?', req.parent!.id);
    res.json(publicAi(req.parent!.id));
  });

  r.post('/ai/test', async (req, res) => {
    const c = getAiConfig(db, req.parent!.id);
    if (!c || !c.model || !c.base_url) throw new HttpError(400, 'Önce AI ayarlarını kaydedin');
    const key = c.api_key_enc ? decrypt(c.api_key_enc, config.encryptionKey) : null;
    try {
      const reply = await new UserKeyProvider(c.base_url, c.model, key).chat([
        { role: 'user', content: 'Merhaba! Tek kelimeyle selam ver.' },
      ]);
      res.json({ ok: true, sample: reply.slice(0, 200) });
    } catch (e) {
      res.json({ ok: false, error: e instanceof Error ? e.message : 'Bağlantı hatası' });
    }
  });

  /* ---- Güvenlik günlüğü ---- */

  r.get('/security/logs', (req, res) => {
    const rows = db.all<{ id: number; ts: number; type: string; detail: string; ip: string }>(
      'SELECT id, ts, type, detail, ip FROM security_logs WHERE user_id = ? ORDER BY ts DESC LIMIT 100',
      req.parent!.id,
    );
    res.json({ items: rows.map((l) => ({ id: l.id, ts: l.ts, type: l.type, detail: l.detail, ip: l.ip })) });
  });

  return r;
}
