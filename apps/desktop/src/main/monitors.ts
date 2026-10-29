import { riskiestWindow } from '@dr/shared';

/**
 * Tüm açık pencerelerin başlığını okur (active-win) ve en riskli olanı bildirir.
 * Başlıklar cihazdan çıkmaz; yalnızca riskli bulunan başlık, ebeveyn izin verdiyse gönderilir.
 */
export class WindowMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastKey = '';
  private busy = false;

  constructor(private onChange: (title: string, risk: number) => void) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1500);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastKey = '';
    this.onChange('', 0);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const mod = await import('active-win');
      type Win = { title?: string; owner?: { name?: string } };
      const aw = (mod.default ?? mod) as unknown as {
        (): Promise<Win | undefined>;
        getOpenWindows?: () => Promise<Win[]>;
      };
      const [active, open] = await Promise.all([aw(), aw.getOpenWindows ? aw.getOpenWindows() : Promise.resolve([] as Win[])]);
      const all = [...(active ? [active] : []), ...open]
        .map((w) => ({ title: w.title ?? '', owner: w.owner?.name ?? '' }))
        .filter((w) => w.title || w.owner);
      const worst = riskiestWindow(all);
      // Risk yoksa ekranda görünen (aktif) pencere başlığı gösterilir.
      const title = worst.risk > 0 ? worst.title : active?.title || active?.owner?.name || '';
      const key = `${title}|${worst.risk}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.onChange(title, worst.risk);
    } catch {
      /* pencere bilgisi alınamadı; sessizce geç */
    } finally {
      this.busy = false;
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
