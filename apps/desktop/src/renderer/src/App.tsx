import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { EMOTIONS, EMOTION_LABELS } from '@dr/shared';
import type { AppState, Guidance } from '../../common/types';
import { startCamera, startMic, type Stopper } from './vision';

const EMOJI: Record<string, string> = {
  neutral: '😐',
  happy: '😃',
  sad: '😢',
  angry: '😠',
  fearful: '😨',
  disgusted: '🤢',
  surprised: '😲',
};

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);

  useEffect(() => {
    void window.agent.getState().then(setState);
    const offState = window.agent.onState(setState);
    const offGuide = window.agent.onGuidance(setGuidance);
    return () => {
      offState();
      offGuide();
    };
  }, []);

  if (!state) return <div className="center muted">Yükleniyor…</div>;

  return (
    <>
      {state.phase === 'setup' && <Setup state={state} />}
      {state.phase === 'consent' && <Consent state={state} />}
      {state.phase === 'running' && <Running state={state} />}
      {guidance && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={guidance.title}>
          <div className="modal">
            <div className="big">🌿</div>
            <h2>{guidance.title}</h2>
            <p>{guidance.description}</p>
            <button className="btn" autoFocus onClick={() => setGuidance(null)}>
              Tamam
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---- İlk kurulum ---- */

function Setup({ state }: { state: AppState }) {
  const [mode, setMode] = useState<'embedded' | 'remote'>(state.serverMode);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const res = await window.agent.pair({
      mode,
      serverUrl: String(f.get('url') ?? ''),
      code: String(f.get('code') ?? ''),
    });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Eşleştirme başarısız');
  }

  return (
    <main className="page">
      <h1>🛡️ Dijital Rehberlik</h1>
      <p className="muted">Bu bilgisayarı ebeveyn paneline bağlayalım.</p>
      <form className="card stack" onSubmit={submit}>
        <fieldset className="stack" style={{ border: 0, padding: 0 }}>
          <legend>Sunucu</legend>
          <label className="radio">
            <input type="radio" checked={mode === 'embedded'} onChange={() => setMode('embedded')} />
            <span>
              <strong>Bu bilgisayardaki yerel sunucu</strong>
              <br />
              <span className="muted small">Varsayılan. Ebeveyn paneli bu bilgisayarda (isterseniz yerel ağda) çalışır.</span>
            </span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'remote'} onChange={() => setMode('remote')} />
            <span>
              <strong>Uzak sunucu</strong>
              <br />
              <span className="muted small">Başka bir yerde çalışan sunucuya (ör. VPS/Docker) bağlanın.</span>
            </span>
          </label>
        </fieldset>

        {mode === 'remote' ? (
          <label className="field">
            Sunucu adresi
            <input name="url" type="url" required placeholder="https://rehberlik.ornek.com" />
          </label>
        ) : (
          <div className="alert info">
            Önce ebeveyn panelini açıp hesap oluşturun, çocuk profili ekleyin ve “Eşleştirme kodu” alın.
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn ghost small" onClick={() => void window.agent.openPanel()} disabled={state.panelUrls.length === 0}>
                Ebeveyn panelini aç
              </button>
            </div>
          </div>
        )}

        <label className="field">
          6 haneli eşleştirme kodu
          <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="off" className="code" />
        </label>
        {(error || state.lastError) && <div className="alert error">{error || state.lastError}</div>}
        <button className="btn" disabled={busy}>
          {busy ? 'Eşleştiriliyor…' : 'Eşleştir'}
        </button>
      </form>
    </main>
  );
}

/* ---- Çocuğa açıklama / rıza ---- */

function Consent({ state }: { state: AppState }) {
  const s = state.settings;
  const items: [boolean | undefined, string][] = [
    [true, 'Bilgisayarı ne kadar süre kullandığın (yalnızca süre).'],
    [s?.screenEnabled, 'Açık pencerenin başlığı (kumar, şiddet gibi uygunsuz içerik var mı diye bakılır). Ekran görüntüsü alınmaz.'],
    [s?.keyboardEnabled, 'Ne kadar hızlı tuşladığın. Yazdığın harfler kaydedilmez.'],
    [s?.cameraEnabled, 'Kameradan yüz ifaden (mutlu, üzgün gibi). Görüntü bilgisayarından çıkmaz.'],
    [s?.micEnabled, 'Mikrofondan ortamın ses yüksekliği. Ses kaydedilmez.'],
  ];
  return (
    <main className="page">
      <h1>Merhaba {state.childName} 👋</h1>
      <p>Bu uygulama, internette güvende olman için anne babanla birlikte çalışır. Şunları yapar:</p>
      <ul className="card list">
        {items
          .filter(([on]) => on)
          .map(([, text]) => (
            <li key={text}>✅ {text}</li>
          ))}
      </ul>
      <p className="muted small">
        Tehlikeli bir durum olursa anne veya baban bilgilendirilir. Şifrelerin, mesajların ve yazdıkların kaydedilmez. İstediğin zaman anne babana
        sorabilirsin.
      </p>
      <button className="btn" onClick={() => void window.agent.acceptConsent()}>
        Anladım, başlat
      </button>
    </main>
  );
}

/* ---- Çalışma ekranı ---- */

function Running({ state }: { state: AppState }) {
  const [tab, setTab] = useState<'status' | 'chat'>('status');
  const [sensorError, setSensorError] = useState('');
  const s = state.settings;

  // Kamera ve mikrofon yalnızca ebeveyn izin verdiğinde açılır.
  const cameraOn = !!s?.cameraEnabled;
  const micOn = !!s?.micEnabled;
  useEffect(() => {
    if (!cameraOn) return;
    let stopper: Stopper | null = null;
    let cancelled = false;
    startCamera((r) => window.agent.sendEmotion(r))
      .then((st) => {
        if (cancelled) st.stop();
        else {
          stopper = st;
          setSensorError('');
        }
      })
      .catch(() => setSensorError('Kamera açılamadı. Windows’ta kamera iznini kontrol edin.'));
    return () => {
      cancelled = true;
      stopper?.stop();
    };
  }, [cameraOn]);
  useEffect(() => {
    if (!micOn) return;
    let stopper: Stopper | null = null;
    let cancelled = false;
    startMic((level) => window.agent.sendAudioLevel(level))
      .then((st) => {
        if (cancelled) st.stop();
        else stopper = st;
      })
      .catch(() => setSensorError('Mikrofon açılamadı. Windows’ta mikrofon iznini kontrol edin.'));
    return () => {
      cancelled = true;
      stopper?.stop();
    };
  }, [micOn]);

  const active = [
    ['Süre', true],
    ['Pencere', s?.screenEnabled],
    ['Klavye hızı', s?.keyboardEnabled],
    ['Kamera', s?.cameraEnabled],
    ['Mikrofon', s?.micEnabled],
  ] as const;

  return (
    <main className="page">
      <header className="row between">
        <div>
          <h1 style={{ marginBottom: 2 }}>Merhaba {state.childName}!</h1>
          <span className={`badge ${state.online ? 'ok' : 'warn'}`}>{state.online ? 'Bağlı' : 'Bağlantı yok'}</span>
        </div>
        <span className="emoji-lg" aria-hidden>
          {EMOJI[state.riskState.emotion]}
        </span>
      </header>

      {state.aiEnabled && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'status'} className={`btn small ${tab === 'status' ? '' : 'ghost'}`} onClick={() => setTab('status')}>
            Durum
          </button>
          <button role="tab" aria-selected={tab === 'chat'} className={`btn small ${tab === 'chat' ? '' : 'ghost'}`} onClick={() => setTab('chat')}>
            Asistan
          </button>
        </div>
      )}

      {sensorError && <div className="alert error">{sensorError}</div>}

      {tab === 'chat' && state.aiEnabled ? (
        <Chat />
      ) : (
        <>
          <section className="card stack" aria-label="İzlenen bilgiler">
            <h2>Şu an neler izleniyor?</h2>
            <div className="row">
              {active.map(([label, on]) => (
                <span key={label} className={`badge ${on ? 'ok' : ''}`}>
                  {on ? '●' : '○'} {label}
                </span>
              ))}
            </div>
            <p className="muted small">Bu ayarları anne baban belirler. Kamera ve mikrofon görüntü/ses kaydetmez.</p>
          </section>

          {s?.cameraEnabled && (
            <section className="card stack" aria-label="Duygu durumu">
              <h2>Duygu durumun</h2>
              {Object.keys(state.expressions).length === 0 ? (
                <p className="muted small">Yüzün görünmüyor.</p>
              ) : (
                EMOTIONS.map((e) => (
                  <div key={e} className="bar-row">
                    <span>
                      {EMOJI[e]} {EMOTION_LABELS[e]}
                    </span>
                    <div className="bar">
                      <div style={{ width: `${state.expressions[e] ?? 0}%` }} />
                    </div>
                    <span className="muted small">%{state.expressions[e] ?? 0}</span>
                  </div>
                ))
              )}
            </section>
          )}

          <details className="card">
            <summary>Ayarlar</summary>
            <div className="stack" style={{ marginTop: 12 }}>
              {!state.isDev && (
                <label className="radio">
                  <input type="checkbox" checked={state.autostart} onChange={(e) => void window.agent.setAutostart(e.target.checked)} />
                  <span>Bilgisayar açılınca otomatik başlat</span>
                </label>
              )}
              {state.serverMode === 'embedded' && (
                <>
                  <label className="radio">
                    <input type="checkbox" checked={state.lanAccess} onChange={(e) => void window.agent.setLanAccess(e.target.checked)} />
                    <span>
                      Ebeveyn panelini yerel ağdan (telefon vb.) erişilebilir yap
                      <br />
                      <span className="muted small">Açıkken panel aynı ağdaki cihazlara açılır.</span>
                    </span>
                  </label>
                  {state.panelUrls.map((u) => (
                    <code key={u}>{u}</code>
                  ))}
                  <button className="btn ghost small" onClick={() => void window.agent.openPanel()}>
                    Ebeveyn panelini aç
                  </button>
                </>
              )}
              <button
                className="btn ghost small"
                onClick={() => {
                  if (confirm('Bu bilgisayarın eşleşmesi kaldırılsın mı? Yeniden eşleştirme için ebeveynden yeni kod gerekir.')) void window.agent.unpair();
                }}
              >
                Eşleşmeyi kaldır
              </button>
              {state.isDev && (
                <div className="row">
                  <button className="btn ghost small" onClick={() => void window.agent.devSimulate('risk')}>
                    [Geliştirme] Riskli durum
                  </button>
                  <button className="btn ghost small" onClick={() => void window.agent.devSimulate('clear')}>
                    [Geliştirme] Sıfırla
                  </button>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </main>
  );
}

/* ---- Asistan sohbeti ---- */

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: 'Merhaba! Ben Rehber. Merak ettiğin bir şeyi bana sorabilirsin.' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    setError('');
    const history = msgs.slice(1).slice(-10);
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    const res = await window.agent.chat(message, history);
    setBusy(false);
    if (res.ok && res.reply) setMsgs((m) => [...m, { role: 'assistant', content: res.reply! }]);
    else setError(res.error ?? 'Asistan yanıt veremedi');
  }

  function speak(t: string) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'tr-TR';
    speechSynthesis.speak(u);
  }

  const Recognition = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  function listen() {
    if (!Recognition) return;
    const r = new Recognition();
    r.lang = 'tr-TR';
    r.onresult = (ev) => setText(ev.results[0][0].transcript);
    r.onerror = () => {
      setListening(false);
      setError('Sesle yazma bu bilgisayarda çalışmadı. Klavyeyle yazabilirsin.');
    };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  }

  return (
    <section className="card chat" aria-label="Asistan sohbeti">
      <div className="messages" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
            {m.role === 'assistant' && (
              <button className="link" aria-label="Sesli oku" onClick={() => speak(m.content)}>
                🔊
              </button>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant muted">Yazıyor…</div>}
        <div ref={endRef} />
      </div>
      {error && <div className="alert error">{error}</div>}
      <form className="row" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Bir şey sor…" maxLength={1000} aria-label="Mesajın" />
        {Recognition && (
          <button type="button" className="btn ghost" onClick={listen} disabled={listening} aria-label="Sesle yaz">
            🎤
          </button>
        )}
        <button className="btn" disabled={busy || !text.trim()}>
          Gönder
        </button>
      </form>
    </section>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start(): void;
}
