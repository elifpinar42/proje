import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { createServer as createHttpServer, type Server } from 'node:http';
import { join } from 'node:path';
import { resolveConfig, type ServerOptions, type ServerConfig } from './config';
import { openDb, type Db } from './db';
import { SseHub, errorHandler, type AppContext } from './context';
import { authRoutes } from './routes/auth';
import { parentRoutes } from './routes/parent';
import { agentRoutes } from './routes/agent';
import { runRetention } from './services/retention';

export interface RunningServer {
  app: express.Express;
  config: ServerConfig;
  db: Db;
  /** Dinlemeye başlar; gerçek (atanmış) portu döner. */
  start(): Promise<{ host: string; port: number }>;
  stop(): Promise<void>;
}

export function createServer(options: ServerOptions): RunningServer {
  const config = resolveConfig(options);
  const db = openDb(config.dataDir);
  const hub = new SseHub();
  const ctx: AppContext = { config, db, hub };

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // Yerel ağda düz HTTP ile de çalışabilmeli.
      hsts: config.secureCookies,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Aynı origin istekleri (Origin başlığı yok / aynı) CORS gerektirmez.
        cb(null, !!origin && config.allowedOrigins.includes(origin));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0', time: Date.now() });
  });
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/agent', agentRoutes(ctx));
  app.use('/api', parentRoutes(ctx));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Uç nokta bulunamadı' });
  });

  if (config.webDir) {
    const webDir = config.webDir;
    app.use(express.static(webDir, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(join(webDir, 'index.html'));
    });
  }
  app.use(errorHandler());

  let server: Server | null = null;
  let timer: NodeJS.Timeout | null = null;

  return {
    app,
    config,
    db,
    start() {
      runRetention(db);
      timer = setInterval(() => runRetention(db), 6 * 60 * 60 * 1000);
      timer.unref();
      return new Promise((resolve, reject) => {
        server = createHttpServer(app);
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          const addr = server!.address();
          const port = typeof addr === 'object' && addr ? addr.port : config.port;
          resolve({ host: config.host, port });
        });
      });
    },
    async stop() {
      if (timer) clearInterval(timer);
      hub.closeAll();
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
