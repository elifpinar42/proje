import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Alert, PageHeader, errMsg } from '../ui';

interface AiConfig {
  mode: 'own_key';
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { label: 'Ollama (yerel)', baseUrl: 'http://localhost:11434/v1', model: '' },
  { label: 'Gemini (OpenAI uyumlu)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '' },
];

export function AiSettings() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .get<AiConfig>('/ai/config')
      .then(setCfg)
      .catch((e) => setError(errMsg(e)));
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cfg) return;
    const f = new FormData(e.currentTarget);
    try {
      const next = await api.put<AiConfig>('/ai/config', {
        enabled: f.get('enabled') === 'on',
        baseUrl: String(f.get('baseUrl')),
        model: String(f.get('model')),
        apiKey: String(f.get('apiKey') ?? '') || undefined,
      });
      setCfg(next);
      (e.currentTarget as HTMLFormElement).reset();
      setMsg('AI ayarları kaydedildi.');
      setError('');
    } catch (err) {
      setError(errMsg(err));
      setMsg('');
    }
  }

  async function test() {
    setTesting(true);
    setMsg('');
    setError('');
    try {
      const r = await api.post<{ ok: boolean; sample?: string; error?: string }>('/ai/test');
      if (r.ok) setMsg(`Bağlantı başarılı. Örnek yanıt: “${r.sample}”`);
      else setError(`Bağlantı başarısız: ${r.error}`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setTesting(false);
    }
  }

  if (!cfg) return <div className="muted">Yükleniyor…</div>;

  return (
    <>
      <PageHeader title="AI asistanı" subtitle="İsteğe bağlı. Kapalıyken uygulama AI olmadan tam çalışır; çocuk ekranında sohbet gizlenir." />
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">
        API anahtarınız sunucuda şifreli saklanır, hiçbir ekrana geri gösterilmez ve çağrılar yalnızca sunucudan yapılır. Çocuğun sohbet mesajları
        seçtiğiniz AI sağlayıcısına gönderilir; tehlike/kişisel bilgi içeren mesajlar önce yerel güvenlik filtresinden geçer ve size bildirilir.
      </Alert>
      <form className="card stack" onSubmit={save} key={`${cfg.baseUrl}${cfg.model}${cfg.hasKey}`}>
        <label className="toggle" style={{ borderBottom: 0 }}>
          <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} />
          <span>
            <strong>AI asistanını etkinleştir</strong>
          </span>
        </label>
        <div className="row">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              className="btn ghost small"
              onClick={() => setCfg({ ...cfg, baseUrl: p.baseUrl })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <label className="field">
          API taban adresi (OpenAI uyumlu /chat/completions)
          <input name="baseUrl" type="url" required defaultValue={cfg.baseUrl} />
        </label>
        <label className="field">
          Model adı
          <input name="model" required defaultValue={cfg.model} placeholder="ör. gpt-4o-mini" />
        </label>
        <label className="field">
          API anahtarı {cfg.hasKey && <span className="badge ok">kayıtlı</span>}
          <input name="apiKey" type="password" autoComplete="off" placeholder={cfg.hasKey ? 'Değiştirmek için yenisini girin' : 'sk-…'} />
        </label>
        <div className="row">
          <button className="btn">Kaydet</button>
          <button type="button" className="btn ghost" disabled={testing || !cfg.model} onClick={test}>
            {testing ? 'Test ediliyor…' : 'Bağlantıyı test et'}
          </button>
          {cfg.hasKey && (
            <button
              type="button"
              className="btn ghost danger"
              onClick={async () => {
                if (!confirm('Kayıtlı API anahtarı silinsin ve AI kapatılsın mı?')) return;
                setCfg(await api.del<AiConfig>('/ai/config/key'));
                setMsg('Anahtar silindi.');
              }}
            >
              Anahtarı sil
            </button>
          )}
        </div>
      </form>
    </>
  );
}
