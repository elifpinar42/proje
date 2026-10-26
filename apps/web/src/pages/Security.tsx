import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Alert, PageHeader, errMsg, fmtTime, useLoad } from '../ui';

const LOG_LABELS: Record<string, string> = {
  login: 'Giriş yapıldı',
  login_failed: 'Başarısız giriş denemesi',
  login_2fa_failed: 'Hatalı doğrulama kodu',
  register: 'Hesap oluşturuldu',
  logout: 'Çıkış yapıldı',
  refresh_reuse_detected: 'Şüpheli oturum yenileme (tüm oturumlar kapatıldı)',
  password_recovered: 'Şifre kurtarma kodu ile sıfırlandı',
  recover_failed: 'Başarısız kurtarma denemesi',
  '2fa_enabled': 'İki adımlı doğrulama açıldı',
  '2fa_disabled': 'İki adımlı doğrulama kapatıldı',
  recovery_codes_regenerated: 'Kurtarma kodları yenilendi',
  session_revoked: 'Oturum sonlandırıldı',
  other_sessions_revoked: 'Diğer oturumlar sonlandırıldı',
  device_removed: 'Cihaz kaldırıldı',
  child_deleted: 'Çocuk profili silindi',
  child_data_deleted: 'Çocuk verileri silindi',
  ai_config_updated: 'AI ayarları değiştirildi',
};

interface SessionRow {
  id: string;
  createdAt: number;
  userAgent: string;
  ip: string;
  current: boolean;
}

export function Security() {
  const { user, setUser } = useSession();
  const sessions = useLoad<{ items: SessionRow[] }>('/auth/sessions');
  const logs = useLoad<{ items: { id: number; ts: number; type: string; detail: string; ip: string }[] }>('/security/logs');
  const me = useLoad<{ recoveryCodesLeft: number }>('/auth/me');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError('');
    } catch (e) {
      setError(errMsg(e));
      setMsg('');
    }
  };

  const startSetup = () => run(async () => setSetup(await api.post('/auth/2fa/setup')));

  const enable = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = String(new FormData(e.currentTarget).get('token'));
    return run(async () => {
      await api.post('/auth/2fa/enable', { token });
      setSetup(null);
      setUser({ ...user!, twoFactorEnabled: true });
      setMsg('İki adımlı doğrulama açıldı.');
      logs.reload();
    });
  };

  const disable = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    return run(async () => {
      await api.post('/auth/2fa/disable', { password: String(f.get('password')), token: String(f.get('token')) });
      setUser({ ...user!, twoFactorEnabled: false });
      setMsg('İki adımlı doğrulama kapatıldı.');
      logs.reload();
    });
  };

  const regen = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password'));
    return run(async () => {
      const r = await api.post<{ recoveryCodes: string[] }>('/auth/recovery-codes', { password });
      setCodes(r.recoveryCodes);
      me.reload();
      logs.reload();
    });
  };

  return (
    <>
      <PageHeader title="Güvenlik" subtitle="Hesabınızı koruyun ve oturumlarınızı yönetin." />
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <section className="card stack">
        <h2>İki adımlı doğrulama (2FA)</h2>
        {user?.twoFactorEnabled ? (
          <form className="stack" onSubmit={disable}>
            <p>
              <span className="badge ok">Açık</span>
            </p>
            <label className="field">
              Şifre
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <label className="field">
              Doğrulama kodu
              <input name="token" inputMode="numeric" required maxLength={10} autoComplete="one-time-code" />
            </label>
            <button className="btn danger" style={{ alignSelf: 'flex-start' }}>
              2FA’yı kapat
            </button>
          </form>
        ) : setup ? (
          <form className="stack" onSubmit={enable}>
            <p className="muted small">Bir kimlik doğrulayıcı uygulama (Google Authenticator, Microsoft Authenticator vb.) ile QR kodu okutun.</p>
            <img src={setup.qrCode} alt="2FA QR kodu" width={180} height={180} style={{ background: 'white', borderRadius: 12, padding: 8 }} />
            <p className="muted small">
              Okutamıyorsanız anahtarı elle girin: <code>{setup.secret}</code>
            </p>
            <label className="field">
              Uygulamadaki 6 haneli kod
              <input name="token" inputMode="numeric" required maxLength={10} autoComplete="one-time-code" />
            </label>
            <button className="btn" style={{ alignSelf: 'flex-start' }}>
              Doğrula ve aç
            </button>
          </form>
        ) : (
          <>
            <p className="muted">Şifrenize ek olarak telefonunuzdaki kodu da isteyerek hesabınızı korur.</p>
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={startSetup}>
              Kurulumu başlat
            </button>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Kurtarma kodları</h2>
        <p className="muted small">Şifrenizi unutursanız hesabınıza dönmenin yoludur. Kalan kullanılmamış kod: {me.data?.recoveryCodesLeft ?? '—'}</p>
        {codes && (
          <>
            <Alert kind="info">Yeni kodlar aşağıda. Eskiler geçersiz oldu; bu kodlar bir daha gösterilmez.</Alert>
            <div className="codes">
              {codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </>
        )}
        <form className="row" onSubmit={regen}>
          <input name="password" type="password" required placeholder="Şifreniz" autoComplete="current-password" style={{ maxWidth: 240 }} />
          <button className="btn ghost">Kodları yenile</button>
        </form>
      </section>

      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Açık oturumlar</h2>
          <button
            className="btn ghost small"
            onClick={() =>
              run(async () => {
                await api.del('/auth/sessions');
                sessions.reload();
                setMsg('Diğer oturumlar sonlandırıldı.');
              })
            }
          >
            Diğerlerini sonlandır
          </button>
        </div>
        <table className="list">
          <tbody>
            {sessions.data?.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.userAgent.slice(0, 60) || 'Bilinmeyen tarayıcı'}</strong> {s.current && <span className="badge ok">Bu oturum</span>}
                  <div className="muted small">
                    {fmtTime(s.createdAt)} • {s.ip}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  {!s.current && (
                    <button
                      className="btn ghost small"
                      onClick={() =>
                        run(async () => {
                          await api.del(`/auth/sessions/${s.id}`);
                          sessions.reload();
                        })
                      }
                    >
                      Sonlandır
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Güvenlik günlüğü</h2>
        <table className="list">
          <tbody>
            {logs.data?.items.map((l) => (
              <tr key={l.id}>
                <td>
                  {LOG_LABELS[l.type] ?? l.type}
                  {l.detail && <span className="muted small"> — {l.detail}</span>}
                </td>
                <td className="muted small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmtTime(l.ts)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
