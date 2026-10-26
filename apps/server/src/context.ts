import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import type { ServerConfig } from './config';
import type { Db } from './db';
import { sha256 } from './security';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Canlı durum akışı (SSE) için ebeveyn başına bağlantı havuzu. */
export class SseHub {
  private clients = new Map<string, Set<Response>>();

  add(parentId: string, res: Response): () => void {
    let set = this.clients.get(parentId);
    if (!set) this.clients.set(parentId, (set = new Set()));
    set.add(res);
    return () => {
      set.delete(res);
      if (set.size === 0) this.clients.delete(parentId);
    };
  }

  publish(parentId: string, type: string, data: unknown): void {
    const set = this.clients.get(parentId);
    if (!set) return;
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(payload);
  }

  closeAll(): void {
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}

export interface AppContext {
  config: ServerConfig;
  db: Db;
  hub: SseHub;
}

export interface ParentAuth {
  id: string;
  sessionId: string;
}
export interface DeviceAuth {
  id: string;
  childId: string;
  parentId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      parent?: ParentAuth;
      device?: DeviceAuth;
    }
  }
}

export function clientIp(req: Request): string {
  return req.ip ?? '';
}

export function logSecurity(
  ctx: AppContext,
  req: Request,
  userId: string | null,
  type: string,
  detail = '',
): void {
  ctx.db.run(
    'INSERT INTO security_logs (user_id, ts, type, detail, ip) VALUES (?,?,?,?,?)',
    userId,
    Date.now(),
    type,
    detail.slice(0, 300),
    clientIp(req),
  );
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

export function requireParent(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Oturum açmanız gerekiyor');
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, ctx.config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw new HttpError(401, 'Oturum süresi doldu veya geçersiz');
    }
    if (payload.role !== 'parent' || !payload.sub || !payload.sid) {
      throw new HttpError(403, 'Bu işlem için yetkiniz yok');
    }
    const session = ctx.db.get<{ revoked: number; expires_at: number }>(
      'SELECT revoked, expires_at FROM refresh_tokens WHERE id = ? AND user_id = ?',
      String(payload.sid),
      String(payload.sub),
    );
    if (!session || session.revoked || session.expires_at < Date.now()) {
      throw new HttpError(401, 'Oturum sonlandırılmış');
    }
    req.parent = { id: String(payload.sub), sessionId: String(payload.sid) };
    next();
  };
}

export function requireDevice(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Cihaz jetonu gerekli');
    const row = ctx.db.get<{ id: string; child_id: string; parent_id: string }>(
      `SELECT d.id, d.child_id, c.parent_id FROM devices d
       JOIN children c ON c.id = d.child_id WHERE d.token_hash = ?`,
      sha256(token),
    );
    if (!row) throw new HttpError(401, 'Cihaz eşleşmesi geçersiz veya kaldırılmış');
    ctx.db.run('UPDATE devices SET last_seen = ? WHERE id = ?', Date.now(), row.id);
    req.device = { id: row.id, childId: row.child_id, parentId: row.parent_id };
    next();
  };
}

/** Çocuğun çağıran ebeveyne ait olduğunu doğrular (aksi halde 404). */
export function ownedChild(ctx: AppContext, req: Request, childId: string) {
  const child = ctx.db.get<{ id: string; name: string; parent_id: string; created_at: number }>(
    'SELECT id, name, parent_id, created_at FROM children WHERE id = ? AND parent_id = ?',
    childId,
    req.parent!.id,
  );
  if (!child) throw new HttpError(404, 'Çocuk profili bulunamadı');
  return child;
}

export function errorHandler(): (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: err.issues[0]?.message ?? 'Geçersiz istek',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Geçersiz JSON' });
      return;
    }
    console.error('[sunucu] beklenmeyen hata:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  };
}
