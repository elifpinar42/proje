import { app, BrowserWindow, ipcMain, Menu, Notification, session, shell, systemPreferences, Tray, nativeImage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createServer, type RunningServer } from '@dr/server';
import { Agent } from './agent';
import { EventQueue } from './queue';
import { Store, dataDir } from './store';
import type { AppState, ChatResult, EmotionPayload, PairRequest } from '../common/types';
import { emotionSchema } from '@dr/shared';

app.setName('Dijital Rehberlik');
process.on('unhandledRejection', (reason) => console.warn('[hata] işlenmeyen söz reddi:', reason));

const EMBEDDED_PORT = 3737;
const IS_DEV = !app.isPackaged;
const START_HIDDEN = process.argv.includes('--hidden');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let embedded: RunningServer | null = null;
let embeddedPort = EMBEDDED_PORT;
let store: Store;
let queue: EventQueue;
let agent: Agent;
let lastError = '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => showWindow());

/* ---- Yollar ---- */

function resourcePath(...parts: string[]): string {
  return IS_DEV ? join(app.getAppPath(), ...parts) : join(process.resourcesPath, ...parts);
}
const webDir = () => (IS_DEV ? join(app.getAppPath(), '../web/dist') : join(process.resourcesPath, 'web'));
const fontsDir = () => (IS_DEV ? join(app.getAppPath(), '../server/fonts') : join(process.resourcesPath, 'fonts'));

/* ---- Gömülü sunucu ---- */

async function startEmbedded(): Promise<void> {
  await stopEmbedded();
  const host = store.get().lanAccess ? '0.0.0.0' : '127.0.0.1';
  const make = (port: number) =>
    createServer({
      dataDir: join(dataDir(), 'server'),
      host,
      port,
      webDir: webDir(),
      fontsDir: fontsDir(),
      allowRegistration: true,
    });
  try {
    embedded = make(EMBEDDED_PORT);
    embeddedPort = (await embedded.start()).port;
  } catch (e) {
    // Port dolu olabilir: rastgele bir port dene.
    try {
      await embedded?.stop().catch(() => undefined);
      embedded = make(0);
      embeddedPort = (await embedded.start()).port;
    } catch (err) {
      embedded = null;
      lastError = `Yerel sunucu başlatılamadı: ${err instanceof Error ? err.message : String(err)}`;
      console.error(lastError, e);
    }
  }
}

async function stopEmbedded(): Promise<void> {
  if (embedded) {
    await embedded.stop().catch(() => undefined);
    embedded = null;
  }
}

function serverUrl(): string {
  const cfg = store.get();
  return cfg.serverMode === 'embedded' ? `http://127.0.0.1:${embeddedPort}` : cfg.serverUrl.replace(/\/+$/, '');
}

function panelUrls(): string[] {
  if (store.get().serverMode !== 'embedded' || !embedded) return [];
  const urls = [`http://localhost:${embeddedPort}`];
  if (store.get().lanAccess) {
    for (const list of Object.values(networkInterfaces())) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) urls.push(`http://${n.address}:${embeddedPort}`);
      }
    }
  }
  return urls;
}

/* ---- Durum ---- */

function buildState(): AppState {
  const cfg = store.get();
  const snap = agent.snapshot();
  const phase = !cfg.deviceToken ? 'setup' : !cfg.consentAccepted ? 'consent' : 'running';
  return {
    phase,
    serverMode: cfg.serverMode,
    serverUrl: cfg.serverMode === 'embedded' ? serverUrl() : cfg.serverUrl,
    panelUrls: panelUrls(),
    childName: cfg.childName,
    settings: snap.settings,
    aiEnabled: snap.aiEnabled,
    online: snap.online,
    risk: snap.risk,
    riskState: snap.riskState,
    expressions: snap.expressions,
    autostart: IS_DEV ? false : app.getLoginItemSettings().openAtLogin,
    lanAccess: cfg.lanAccess,
    lastError: lastError || snap.lastError,
    isDev: IS_DEV,
  };
}

function pushState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agent:state', buildState());
}

/* ---- Pencere ve tray ---- */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 780,
    minWidth: 400,
    minHeight: 600,
    show: false,
    title: 'Dijital Rehberlik',
    icon: resourcePath('resources/icon.png'),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault();
  });
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.once('ready-to-show', () => {
    const running = store.get().deviceToken && store.get().consentAccepted;
    if (!(START_HIDDEN && running)) mainWindow?.show();
  });
  if (IS_DEV && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

function createTray(): void {
  const iconPath = resourcePath('resources/tray.png');
  tray = new Tray(existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip('Dijital Rehberlik');
  const rebuild = () => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Uygulamayı aç', click: showWindow },
        {
          label: 'Ebeveyn panelini aç',
          enabled: store.get().serverMode === 'embedded' && !!embedded,
          click: () => void openPanel(),
        },
        { type: 'separator' },
        {
          label: 'Çıkış',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  rebuild();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

async function openPanel(): Promise<void> {
  const url = panelUrls()[0];
  if (url) await shell.openExternal(url);
}

/* ---- IPC ---- */

function fromRenderer(e: IpcMainInvokeEvent): boolean {
  return !!mainWindow && e.sender === mainWindow.webContents;
}

function registerIpc(): void {
  ipcMain.handle('agent:getState', (e) => (fromRenderer(e) ? buildState() : null));

  ipcMain.handle('agent:pair', async (e, req: PairRequest) => {
    if (!fromRenderer(e)) return { ok: false, error: 'Yetkisiz' };
    const code = String(req?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Kod 6 haneli olmalı' };
    if (req.mode === 'remote') {
      let url: URL;
      try {
        url = new URL(String(req.serverUrl));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
      } catch {
        return { ok: false, error: 'Geçerli bir sunucu adresi girin (ör. https://rehberlik.ornek.com)' };
      }
      store.update({ serverMode: 'remote', serverUrl: url.origin + url.pathname.replace(/\/+$/, '') });
      await stopEmbedded();
    } else {
      store.update({ serverMode: 'embedded' });
      if (!embedded) await startEmbedded();
    }
    const result = await agent.pair(code, req.deviceName);
    pushState();
    return result;
  });

  ipcMain.handle('agent:acceptConsent', (e) => {
    if (!fromRenderer(e)) return;
    store.update({ consentAccepted: true });
    agent.start();
    pushState();
  });

  ipcMain.handle('agent:unpair', (e) => {
    if (!fromRenderer(e)) return;
    agent.unpair();
    pushState();
  });

  ipcMain.on('agent:emotion', (e, p: EmotionPayload) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return;
    if (!emotionSchema.safeParse(p?.emotion).success) return;
    agent.setEmotion({
      emotion: p.emotion,
      faceDetected: !!p.faceDetected,
      expressions: Object.fromEntries(Object.entries(p.expressions ?? {}).map(([k, v]) => [k, Math.max(0, Math.min(100, Number(v) || 0))])),
    });
  });

  ipcMain.on('agent:audio', (e, level: number) => {
    if (!mainWindow || e.sender !== mainWindow.webContents) return;
    const n = Number(level);
    if (Number.isFinite(n)) agent.setAudioLevel(Math.max(0, Math.min(100, n)));
  });

  ipcMain.handle('agent:chat', async (e, message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<ChatResult> => {
    if (!fromRenderer(e)) return { ok: false, error: 'Yetkisiz' };
    const msg = String(message ?? '').slice(0, 1000);
    const hist = Array.isArray(history) ? history.slice(-20).map((h) => ({ role: h.role === 'assistant' ? 'assistant' as const : 'user' as const, content: String(h.content).slice(0, 2000) })) : [];
    return agent.chat(msg, hist);
  });

  ipcMain.handle('agent:mediaStatus', (e) => {
    if (!fromRenderer(e)) return null;
    const get = (t: 'camera' | 'microphone') => {
      try {
        return systemPreferences.getMediaAccessStatus(t);
      } catch {
        return 'unknown';
      }
    };
    return { camera: get('camera'), microphone: get('microphone') };
  });

  ipcMain.handle('agent:openPrivacy', async (e, kind: 'camera' | 'microphone') => {
    if (!fromRenderer(e)) return;
    await shell.openExternal(kind === 'microphone' ? 'ms-settings:privacy-microphone' : 'ms-settings:privacy-webcam');
  });

  ipcMain.handle('agent:openPanel', (e) => (fromRenderer(e) ? openPanel() : undefined));

  ipcMain.handle('agent:setAutostart', (e, enabled: boolean) => {
    if (!fromRenderer(e) || IS_DEV) return;
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: ['--hidden'] });
    pushState();
  });

  ipcMain.handle('agent:setLanAccess', async (e, enabled: boolean) => {
    if (!fromRenderer(e)) return;
    store.update({ lanAccess: !!enabled });
    if (store.get().serverMode === 'embedded') await startEmbedded();
    pushState();
  });

  ipcMain.handle('agent:devSimulate', (e, kind: 'risk' | 'clear') => {
    if (!fromRenderer(e) || !IS_DEV) return;
    agent.devSimulate(kind === 'risk' ? 'risk' : 'clear');
  });
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  // Yalnızca kendi arayüzümüz (file:// veya geliştirme sunucusu) kamera/mikrofon isteyebilir.
  const ownOrigin = (origin?: string) =>
    !!origin && (origin.startsWith('file://') || (!!process.env['ELECTRON_RENDERER_URL'] && origin.startsWith(new URL(process.env['ELECTRON_RENDERER_URL']).origin)));
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const url = (details as { requestingUrl?: string }).requestingUrl;
    cb(permission === 'media' && (wc === mainWindow?.webContents || ownOrigin(url)));
  });
  // Not: webContents bu denetimde null gelebilir; kaynak adresine bakılır.
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === 'media' && ownOrigin(requestingOrigin));
}

/* ---- Başlangıç ---- */

app.whenReady().then(async () => {
  if (!app.isReady()) return;
  store = new Store();
  queue = new EventQueue();
  agent = new Agent(store, queue, serverUrl);
  agent.on('change', pushState);
  agent.on('unpaired', pushState);
  agent.on('guidance', (g) => {
    showWindow();
    mainWindow?.webContents.send('agent:guidance', g);
    if (Notification.isSupported()) new Notification({ title: g.title, body: g.description }).show();
  });

  lockDownSession();
  registerIpc();
  if (store.get().serverMode === 'embedded') await startEmbedded();
  createWindow();
  createTray();
  agent.start();
});

app.on('before-quit', () => {
  isQuitting = true;
});
app.on('window-all-closed', () => {
  /* tray'de çalışmaya devam eder */
});
app.on('will-quit', () => {
  agent?.stop();
  queue?.close();
  void stopEmbedded();
});
