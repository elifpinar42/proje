import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, refreshSession, setAccessToken, setSessionLostHandler, type Child, type User } from './api';
import { SessionContext, useSession, type Session } from './session';
import { AuthPage } from './pages/Auth';
import { Overview } from './pages/Overview';
import { History } from './pages/History';
import { Children } from './pages/Children';
import { Settings } from './pages/Settings';
import { AiSettings } from './pages/AiSettings';
import { Security } from './pages/Security';

function readStored(): string | null {
  try {
    return localStorage.getItem('dr_child');
  } catch {
    return null;
  }
}

const NAV: { to: string; label: string; icon: string }[] = [
  { to: '/', label: 'Genel bakış', icon: '🏠' },
  { to: '/gecmis', label: 'Geçmiş', icon: '🕘' },
  { to: '/cocuklar', label: 'Çocuklar', icon: '👧' },
  { to: '/ayarlar', label: 'Ayarlar', icon: '⚙️' },
  { to: '/ai', label: 'AI', icon: '✨' },
  { to: '/guvenlik', label: 'Güvenlik', icon: '🔐' },
];

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);
  const [childId, setChildIdState] = useState<string | null>(readStored());
  const navigate = useNavigate();

  const reloadChildren = useCallback(async () => {
    const res = await api.get<{ items: Child[] }>('/children');
    setChildren(res.items);
    setChildIdState((cur) => (cur && res.items.some((c) => c.id === cur) ? cur : (res.items[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      navigate('/giris');
    });
    refreshSession().then((u) => {
      setUser(u);
      setReady(true);
    });
  }, [navigate]);

  useEffect(() => {
    if (user) reloadChildren().catch(() => undefined);
  }, [user, reloadChildren]);

  const session = useMemo<Session>(
    () => ({
      user,
      setUser,
      async logout() {
        await api.post('/auth/logout').catch(() => undefined);
        setAccessToken(null);
        setUser(null);
        setChildren([]);
        navigate('/giris');
      },
      children,
      reloadChildren,
      childId,
      setChildId(id: string) {
        setChildIdState(id);
        try {
          localStorage.setItem('dr_child', id);
        } catch {
          /* yoksay */
        }
      },
    }),
    [user, children, childId, reloadChildren, navigate],
  );

  if (!ready) return <div className="center muted">Yükleniyor…</div>;

  return (
    <SessionContext.Provider value={session}>
      <Routes>
        <Route path="/giris" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
        <Route
          path="*"
          element={
            user ? (
              <Shell>
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/gecmis" element={<History />} />
                  <Route path="/cocuklar" element={<Children />} />
                  <Route path="/ayarlar" element={<Settings />} />
                  <Route path="/ai" element={<AiSettings />} />
                  <Route path="/guvenlik" element={<Security />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Shell>
            ) : (
              <Navigate to="/giris" replace />
            )
          }
        />
      </Routes>
    </SessionContext.Provider>
  );
}

function Shell({ children: page }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Sayfa değişince mobildeki yan menü kapanır.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn ghost small" aria-label="Menüyü aç" aria-expanded={open} aria-controls="sidebar" onClick={() => setOpen((o) => !o)}>
          ☰
        </button>
        <span className="brand">🛡️ Dijital Rehberlik</span>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}
      <aside id="sidebar" className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">🛡️ Dijital Rehberlik</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span aria-hidden>{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="muted small">{user?.username}</span>
          <button className="btn ghost small" onClick={logout}>
            Çıkış
          </button>
        </div>
      </aside>
      <main className="content">{page}</main>
    </div>
  );
}
