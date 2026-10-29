import { Router } from 'express';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { loginSchema, recoverSchema, registerSchema } from '@dr/shared';
import {
  type AppContext,
  HttpError,
  clientIp,
  logSecurity,
  requireParent,
} from '../context';
import {
  decrypt,
  encrypt,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  newId,
  normalizeRecoveryCode,
  otpauthUrl,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
} from '../security';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'dr_refresh';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
}

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db, config } = ctx;
  const parentOnly = requireParent(ctx);

  const limiter = (max: number) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.disableRateLimit ? 100000 : max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' },
    });

  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
    path: '/api/auth',
    maxAge: REFRESH_TTL_MS,
  };

  function issueSession(req: Request, res: Response, user: UserRow) {
    const sid = newId();
    const refresh = randomToken(32);
    const now = Date.now();
    db.run(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at, user_agent, ip)
       VALUES (?,?,?,?,?,?,?)`,
      sid,
      user.id,
      sha256(refresh),
      now,
      now + REFRESH_TTL_MS,
      String(req.headers['user-agent'] ?? '').slice(0, 200),
      clientIp(req),
    );
    res.cookie(COOKIE, refresh, cookieOpts);
    const accessToken = jwt.sign({ role: 'parent', sid }, config.jwtSecret, {
      subject: user.id,
      expiresIn: ACCESS_TTL_S,
      algorithm: 'HS256',
    });
    return { accessToken, expiresIn: ACCESS_TTL_S };
  }

  function newRecoveryCodes(userId: string): string[] {
    const codes = generateRecoveryCodes();
    db.transaction(() => {
      db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
      for (const c of codes) {
        db.run(
          'INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)',
          userId,
          sha256(normalizeRecoveryCode(c)),
        );
      }
    });
    return codes;
  }

  const publicUser = (u: UserRow) => ({
    id: u.id,
    username: u.username,
    role: 'parent' as const,
    twoFactorEnabled: !!u.totp_enabled,
  });

  r.post('/register', limiter(10), async (req, res) => {
    if (!config.allowRegistration) throw new HttpError(403, 'Yeni kayıt kapalı');
    const body = registerSchema.parse(req.body);
    if (db.get('SELECT 1 AS x FROM users WHERE username = ?', body.username)) {
      throw new HttpError(409, 'Bu kullanıcı adı zaten kayıtlı');
    }
    const id = newId();
    db.run(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)',
      id,
      body.username,
      await hashPassword(body.password),
      Date.now(),
    );
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
    const recoveryCodes = newRecoveryCodes(id);
    logSecurity(ctx, req, id, 'register');
    res.status(201).json({ ...issueSession(req, res, user), user: publicUser(user), recoveryCodes });
  });

  r.post('/login', limiter(20), async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = db.get<UserRow>('SELECT * FROM users WHERE username = ?', body.username);
    const ok = user
      ? await verifyPassword(body.password, user.password_hash)
      : (await verifyPassword(body.password, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AA=='), false);
    if (!user || !ok) {
      logSecurity(ctx, req, user?.id ?? null, 'login_failed', body.username);
      throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı');
    }
    if (user.totp_enabled) {
      if (!body.totp) throw new HttpError(401, 'Doğrulama kodu gerekli', { totpRequired: true });
      const secret = user.totp_secret_enc ? decrypt(user.totp_secret_enc, config.encryptionKey) : null;
      if (!secret || !verifyTotp(secret, body.totp)) {
        logSecurity(ctx, req, user.id, 'login_2fa_failed');
        throw new HttpError(401, 'Doğrulama kodu hatalı', { totpRequired: true });
      }
    }
    logSecurity(ctx, req, user.id, 'login');
    res.json({ ...issueSession(req, res, user), user: publicUser(user) });
  });

  r.post('/refresh', limiter(120), (req, res) => {
    const token = req.cookies?.[COOKIE] as string | undefined;
    if (!token) throw new HttpError(401, 'Oturum bulunamadı');
    const row = db.get<{
      id: string;
      user_id: string;
      revoked: number;
      expires_at: number;
    }>('SELECT id, user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = ?', sha256(token));
    if (!row) {
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Oturum geçersiz');
    }
    if (row.revoked) {
      // Çalınmış/yeniden kullanılmış yenileme jetonu şüphesi: tüm oturumları kapat.
      db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', row.user_id);
      logSecurity(ctx, req, row.user_id, 'refresh_reuse_detected');
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Oturum geçersiz');
    }
    if (row.expires_at < Date.now()) {
      res.clearCookie(COOKIE, { path: '/api/auth' });
      throw new HttpError(401, 'Oturum süresi doldu');
    }
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!user) throw new HttpError(401, 'Oturum geçersiz');
    db.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', row.id);
    res.json({ ...issueSession(req, res, user), user: publicUser(user) });
  });

  r.post('/logout', parentOnly, (req, res) => {
    db.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', req.parent!.sessionId);
    res.clearCookie(COOKIE, { path: '/api/auth' });
    logSecurity(ctx, req, req.parent!.id, 'logout');
    res.json({ ok: true });
  });

  r.get('/me', parentOnly, (req, res) => {
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.parent!.id);
    if (!user) throw new HttpError(401, 'Hesap bulunamadı');
    const codes = db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used = 0',
      user.id,
    )!;
    res.json({ user: publicUser(user), recoveryCodesLeft: Number(codes.n) });
  });

  r.get('/sessions', parentOnly, (req, res) => {
    const rows = db.all<{
      id: string;
      created_at: number;
      user_agent: string;
      ip: string;
    }>(
      `SELECT id, created_at, user_agent, ip FROM refresh_tokens
       WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC`,
      req.parent!.id,
      Date.now(),
    );
    res.json({
      items: rows.map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        userAgent: s.user_agent,
        ip: s.ip,
        current: s.id === req.parent!.sessionId,
      })),
    });
  });

  r.delete('/sessions/:id', parentOnly, (req, res) => {
    const result = db.run(
      'UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND user_id = ?',
      String(req.params.id),
      req.parent!.id,
    );
    if (!result.changes) throw new HttpError(404, 'Oturum bulunamadı');
    logSecurity(ctx, req, req.parent!.id, 'session_revoked');
    res.json({ ok: true });
  });

  r.delete('/sessions', parentOnly, (req, res) => {
    db.run(
      'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND id != ?',
      req.parent!.id,
      req.parent!.sessionId,
    );
    logSecurity(ctx, req, req.parent!.id, 'other_sessions_revoked');
    res.json({ ok: true });
  });

  r.post('/recover', limiter(10), async (req, res) => {
    const body = recoverSchema.parse(req.body);
    const user = db.get<UserRow>('SELECT * FROM users WHERE username = ?', body.username);
    const hash = sha256(normalizeRecoveryCode(body.recoveryCode));
    const code = user
      ? db.get<{ id: number }>(
          'SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used = 0',
          user.id,
          hash,
        )
      : undefined;
    if (!user || !code) {
      logSecurity(ctx, req, user?.id ?? null, 'recover_failed', body.username);
      throw new HttpError(400, 'Kullanıcı adı veya kurtarma kodu hatalı');
    }
    const pwHash = await hashPassword(body.newPassword);
    db.transaction(() => {
      db.run('UPDATE recovery_codes SET used = 1 WHERE id = ?', code.id);
      db.run(
        `UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret_enc = NULL,
         totp_pending_enc = NULL WHERE id = ?`,
        pwHash,
        user.id,
      );
      db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', user.id);
    });
    logSecurity(ctx, req, user.id, 'password_recovered');
    res.json({ ok: true });
  });

  const passwordConfirm = z.object({ password: z.string().min(1).max(128) });

  r.post('/recovery-codes', parentOnly, async (req, res) => {
    const { password } = passwordConfirm.parse(req.body);
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.parent!.id)!;
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(403, 'Şifre hatalı');
    }
    logSecurity(ctx, req, user.id, 'recovery_codes_regenerated');
    res.json({ recoveryCodes: newRecoveryCodes(user.id) });
  });

  r.post('/2fa/setup', parentOnly, async (req, res) => {
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.parent!.id)!;
    if (user.totp_enabled) throw new HttpError(409, 'İki adımlı doğrulama zaten açık');
    const secret = generateTotpSecret();
    db.run(
      'UPDATE users SET totp_pending_enc = ? WHERE id = ?',
      encrypt(secret, config.encryptionKey),
      user.id,
    );
    const url = otpauthUrl(secret, user.username);
    res.json({ secret, otpauthUrl: url, qrCode: await QRCode.toDataURL(url) });
  });

  r.post('/2fa/enable', parentOnly, (req, res) => {
    const { token } = z.object({ token: z.string().max(10) }).parse(req.body);
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.parent!.id)!;
    const secret = user.totp_pending_enc ? decrypt(user.totp_pending_enc, config.encryptionKey) : null;
    if (!secret) throw new HttpError(400, 'Önce kurulumu başlatın');
    if (!verifyTotp(secret, token)) throw new HttpError(400, 'Doğrulama kodu hatalı');
    db.run(
      'UPDATE users SET totp_enabled = 1, totp_secret_enc = ?, totp_pending_enc = NULL WHERE id = ?',
      encrypt(secret, config.encryptionKey),
      user.id,
    );
    logSecurity(ctx, req, user.id, '2fa_enabled');
    res.json({ ok: true });
  });

  r.post('/2fa/disable', parentOnly, async (req, res) => {
    const body = z.object({ password: z.string().max(128), token: z.string().max(10) }).parse(req.body);
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', req.parent!.id)!;
    const secret = user.totp_secret_enc ? decrypt(user.totp_secret_enc, config.encryptionKey) : null;
    if (!user.totp_enabled || !secret) throw new HttpError(400, 'İki adımlı doğrulama kapalı');
    if (!(await verifyPassword(body.password, user.password_hash)) || !verifyTotp(secret, body.token)) {
      throw new HttpError(403, 'Şifre veya doğrulama kodu hatalı');
    }
    db.run(
      'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL WHERE id = ?',
      user.id,
    );
    logSecurity(ctx, req, user.id, '2fa_disabled');
    res.json({ ok: true });
  });

  return r;
}
