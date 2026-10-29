import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, setAccessToken, ApiError, type User } from '../api';
import { useSession } from '../session';
import { Alert, errMsg } from '../ui';

type Mode = 'login' | 'register' | 'recover';

export function AuthPage() {
  const { setUser } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [needTotp, setNeedTotp] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [pendingUser, setPendingUser] = useState<User | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (k: string) => String(f.get(k) ?? '');
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const res = await api.post<{ accessToken: string; user: User }>('/auth/login', {
          username: val('username'),
          password: val('password'),
          totp: val('totp') || undefined,
        });
        setAccessToken(res.accessToken);
        setUser(res.user);
      } else if (mode === 'register') {
        if (val('password') !== val('password2')) throw new Error('Şifreler eşleşmiyor');
        const res = await api.post<{ accessToken: string; user: User; recoveryCodes: string[] }>('/auth/register', {
          username: val('username'),
          password: val('password'),
        });
        setAccessToken(res.accessToken);
        setPendingUser(res.user);
        setNewCodes(res.recoveryCodes);
      } else {
        await api.post('/auth/recover', {
          username: val('username'),
          recoveryCode: val('code'),
          newPassword: val('password'),
        });
        setMode('login');
        setInfo('Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.body.totpRequired) setNeedTotp(true);
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (newCodes && pendingUser) {
    return (
      <div className="auth">
        <div className="card stack">
          <h1>Kurtarma kodlarınız</h1>
          <Alert kind="info">
            Bu kodlar şifrenizi unutursanız hesabınıza dönmenin tek yoludur ve <strong>bir daha gösterilmez</strong>. Güvenli bir yere kaydedin.
          </Alert>
          <div className="codes" data-testid="recovery-codes">
            {newCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button className="btn" onClick={() => setUser(pendingUser)}>
            Kodları kaydettim, devam et
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>🛡️ Dijital Rehberlik</h1>
          <p className="muted small">Ebeveyn paneli</p>
        </div>
        <div className="tabs" role="tablist">
          {(
            [
              ['login', 'Giriş'],
              ['register', 'Kayıt'],
              ['recover', 'Şifremi unuttum'],
            ] as [Mode, string][]
          ).map(([m, label]) => (
            <button
              type="button"
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`btn small ${mode === m ? '' : 'ghost'}`}
              onClick={() => {
                setMode(m);
                setError('');
                setInfo('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {info && <Alert kind="ok">{info}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <label className="field">
          Kullanıcı adı
          <input name="username" autoComplete="username" required minLength={3} maxLength={32} />
        </label>
        {mode === 'recover' && (
          <label className="field">
            Kurtarma kodu
            <input name="code" placeholder="XXXX-XXXX" required autoComplete="off" />
          </label>
        )}
        <label className="field">
          {mode === 'recover' ? 'Yeni şifre' : 'Şifre'}
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'login' ? 1 : 8}
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            Şifre (tekrar)
            <input name="password2" type="password" autoComplete="new-password" required />
          </label>
        )}
        {mode !== 'login' && <p className="muted small">En az 8 karakter; en az bir harf ve bir rakam içermeli.</p>}
        {mode === 'login' && needTotp && (
          <label className="field">
            Doğrulama kodu (6 hane)
            <input name="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required autoFocus />
          </label>
        )}
        <button className="btn" disabled={busy}>
          {mode === 'login' ? 'Giriş yap' : mode === 'register' ? 'Hesap oluştur' : 'Şifreyi sıfırla'}
        </button>
        {mode === 'recover' && (
          <p className="muted small">Kurtarma kodu kullanıldığında iki adımlı doğrulama da kapatılır ve tüm oturumlar sonlandırılır.</p>
        )}
      </form>
    </div>
  );
}
