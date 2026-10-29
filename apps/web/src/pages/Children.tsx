import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Alert, PageHeader, errMsg, fmtTime, useLoad } from '../ui';

interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeen: number | null;
}

function PairCode({ childId }: { childId: string }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const s = Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setCode(null);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code]);

  return (
    <div className="stack">
      {error && <Alert kind="error">{error}</Alert>}
      {code ? (
        <div className="stack">
          <div className="pair-code" data-testid="pair-code">
            {code.code}
          </div>
          <p className="muted small">
            Bu kodu çocuğun bilgisayarındaki Dijital Rehberlik uygulamasına girin. Geçerlilik: {Math.floor(left / 60)}:
            {String(left % 60).padStart(2, '0')}
          </p>
        </div>
      ) : null}
      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          try {
            setCode(await api.post(`/children/${childId}/pairing-code`));
            setError('');
          } catch (e) {
            setError(errMsg(e));
          }
        }}
      >
        {code ? 'Yeni kod üret' : 'Eşleştirme kodu üret'}
      </button>
    </div>
  );
}

function UnpairCode({ childId }: { childId: string }) {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <p className="muted small">
        Çocuk, kendi bilgisayarındaki eşleşmeyi yalnızca sizin verdiğiniz bu kodla kaldırabilir.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {code && (
        <div className="stack">
          <div className="pair-code" data-testid="unpair-code">
            {code.code}
          </div>
          <p className="muted small">10 dakika geçerli, tek kullanımlık.</p>
        </div>
      )}
      <button
        className="btn ghost small"
        style={{ alignSelf: 'flex-start' }}
        onClick={async () => {
          try {
            setCode(await api.post(`/children/${childId}/unpair-code`));
            setError('');
          } catch (e) {
            setError(errMsg(e));
          }
        }}
      >
        Eşleşmeyi kaldırma kodu üret
      </button>
    </div>
  );
}

function ChildCard({ id, name }: { id: string; name: string }) {
  const { reloadChildren } = useSession();
  const devices = useLoad<{ items: Device[] }>(`/children/${id}/devices`);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <section className="card stack" aria-label={`${name} profili`}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{name}</h2>
      </div>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <div>
        <h3>Cihazlar</h3>
        {devices.data?.items.length === 0 && <p className="muted small">Henüz cihaz eşleşmedi.</p>}
        <table className="list">
          <tbody>
            {devices.data?.items.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.name}</strong>
                  <div className="muted small">Son görülme: {fmtTime(d.lastSeen)}</div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      if (!confirm(`“${d.name}” cihazının eşleşmesi kaldırılsın mı?`)) return;
                      act(async () => {
                        await api.del(`/devices/${d.id}`);
                        devices.reload();
                        await reloadChildren();
                      }, 'Cihaz kaldırıldı.');
                    }}
                  >
                    Kaldır
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3>Yeni cihaz eşleştir</h3>
        <PairCode childId={id} />
      </div>

      <div>
        <h3>Eşleşmeyi kaldırma kodu</h3>
        <UnpairCode childId={id} />
      </div>

      <div className="row">
        <button
          className="btn ghost small"
          onClick={() => {
            if (!confirm(`${name} için kaydedilmiş tüm olaylar, nabızlar ve sohbet kayıtları silinsin mi? Bu işlem geri alınamaz.`)) return;
            act(() => api.del(`/children/${id}/data`), 'Tüm veriler silindi.');
          }}
        >
          Tüm verileri sil
        </button>
        <button
          className="btn danger small"
          onClick={() => {
            if (!confirm(`${name} profili ve tüm verileri kalıcı olarak silinsin mi?`)) return;
            act(async () => {
              await api.del(`/children/${id}`);
              await reloadChildren();
            }, 'Profil silindi.');
          }}
        >
          Profili sil
        </button>
      </div>
    </section>
  );
}

function LanInfo() {
  const info = useLoad<{ port: number; lanUrls: string[] }>('/server-info');
  if (!info.data || info.data.lanUrls.length === 0) return null;
  return (
    <section className="card stack" aria-label="Yerel ağ adresi">
      <h2 style={{ margin: 0 }}>Telefondan erişim</h2>
      <p className="muted small">Aynı Wi-Fi ağındaki telefon veya bilgisayardan bu panele şu adreslerle girebilirsiniz:</p>
      {info.data.lanUrls.map((u) => (
        <code key={u} style={{ alignSelf: 'flex-start' }}>
          {u}
        </code>
      ))}
    </section>
  );
}

export function Children() {
  const { children, reloadChildren, setChildId } = useSession();
  const [error, setError] = useState('');

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name') ?? '');
    try {
      const res = await api.post<{ id: string }>('/children', { name });
      await reloadChildren();
      setChildId(res.id);
      form.reset();
      setError('');
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <>
      <PageHeader title="Çocuklar ve cihazlar" subtitle="Her çocuk için profil oluşturun, sonra cihazı 6 haneli kodla eşleştirin." />
      <form className="card row" onSubmit={add}>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          Çocuğun adı
          <input name="name" required maxLength={40} />
        </label>
        <button className="btn" style={{ alignSelf: 'flex-end' }}>
          Profil ekle
        </button>
      </form>
      {error && <Alert kind="error">{error}</Alert>}
      <LanInfo />
      {children.map((c) => (
        <ChildCard key={c.id} id={c.id} name={c.name} />
      ))}
    </>
  );
}
