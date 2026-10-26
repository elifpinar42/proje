import { windowRiskFromTitle } from '@dr/shared';

/** Aktif pencere başlığını okur (active-win). Başlık metni cihazdan yalnızca risk olayında gönderilir. */
export class WindowMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastKey = '';

  constructor(private onChange: (title: string, risk: number) => void) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 4000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastKey = '';
    this.onChange('', 0);
  }

  private async tick(): Promise<void> {
    try {
      const mod = await import('active-win');
      const activeWindow = (mod.default ?? mod) as unknown as () => Promise<{ title?: string; owner?: { name?: string } } | undefined>;
      const win = await activeWindow();
      if (!win) return;
      const title = win.title ?? '';
      const owner = win.owner?.name ?? '';
      const key = `${title}|${owner}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.onChange(title || owner, windowRiskFromTitle(title, owner));
    } catch {
      /* pencere bilgisi alınamadı; sessizce geç */
    }
  }
}

/** Yalnızca tuşlama SAYISINI ölçer; basılan tuşlar kaydedilmez. */
export class KeyboardMonitor {
  private listener: { kill(): void } | null = null;
  private times: number[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private onRate: (countIn5s: number) => void) {}

  async start(): Promise<void> {
    if (this.listener) return;
    try {
      const mod = (await import('node-global-key-listener')) as unknown as {
        GlobalKeyboardListener: new (config?: { windows?: { onError?: (code: number) => void } }) => {
          addListener(cb: (e: { state?: string }) => void): void;
          kill(): void;
        };
      };
      const l = new mod.GlobalKeyboardListener({
        windows: { onError: (code) => console.warn('[klavye] Windows klavye sunucusu hata verdi:', code) },
      });
      l.addListener((e) => {
        if (e.state === 'DOWN') this.times.push(Date.now());
      });
      this.listener = l;
      this.timer = setInterval(() => {
        const now = Date.now();
        this.times = this.times.filter((t) => now - t < 5000);
        this.onRate(this.times.length);
      }, 2000);
    } catch (e) {
      console.warn('[klavye] dinleyici başlatılamadı:', e instanceof Error ? e.message : e);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.listener?.kill();
    } catch {
      /* yoksay */
    }
    this.listener = null;
    this.times = [];
    this.onRate(0);
  }
}
