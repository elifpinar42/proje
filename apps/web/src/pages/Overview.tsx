import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, subscribeLive, type EventItem, type Status, type Summary } from '../api';
import { useSession } from '../session';
import {
  Alert,
  ChildPicker,
  NoChild,
  PageHeader,
  RiskBar,
  emotionLabel,
  errMsg,
  fmtDuration,
  fmtTime,
  riskColor,
  useLoad,
} from '../ui';

export function Overview() {
  const { childId, children } = useSession();
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const status = useLoad<Status>(childId ? `/children/${childId}/status` : null);
  const summary = useLoad<Summary>(childId ? `/children/${childId}/summary?days=1&tz=${new Date().getTimezoneOffset()}` : null);
  const events = useLoad<{ items: EventItem[]; total: number }>(childId ? `/children/${childId}/events?limit=5` : null);

  useEffect(() => {
    if (!childId) return;
    const stop = subscribeLive(
      (m) => {
        if (m.data.childId !== childId) return;
        if (m.type === 'heartbeat') {
          status.reload();
          summary.reload();
        } else {
          events.reload();
          status.reload();
        }
      },
      setLive,
    );
    // Bağlantı yokken de durum 30 sn'de bir tazelenir.
    const t = setInterval(() => status.reload(), 30_000);
    return () => {
      stop();
      clearInterval(t);
    };
    // eslint-disable-next-line
  }, [childId]);

  if (children.length === 0) {
    return (
      <>
        <PageHeader title="Genel bakış" />
        <NoChild />
        <Link className="btn" style={{ alignSelf: 'flex-start', textDecoration: 'none' }} to="/cocuklar">
          Çocuk ekle
        </Link>
      </>
    );
  }

  const s = status.data;
  const sum = summary.data;
  const childName = children.find((c) => c.id === childId)?.name ?? '';

  async function pdf() {
    setError('');
    try {
      await api.download(`/reports/pdf?tz=${new Date().getTimezoneOffset()}`, { childId, days: 7 }, `rapor-${childName}.pdf`);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <>
      <PageHeader title="Genel bakış" subtitle={live ? '● Canlı bağlantı açık' : '○ Canlı bağlantı yok (sayfa periyodik yenilenir)'}>
        <div className="row">
          <ChildPicker />
          <button className="btn ghost small" onClick={pdf}>
            Haftalık PDF raporu
          </button>
        </div>
      </PageHeader>
      {error && <Alert kind="error">{error}</Alert>}

      <section className="card stack" aria-label="Anlık durum">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{childName} — anlık durum</h2>
          {s && (
            <span className={`badge ${s.online ? 'ok' : ''}`}>{s.online ? 'Çevrimiçi' : s.deviceCount ? 'Çevrimdışı' : 'Cihaz eşleşmedi'}</span>
          )}
        </div>
        {s && s.deviceCount === 0 && (
          <Alert kind="info">
            Henüz bir cihaz eşleşmedi. <Link to="/cocuklar">Çocuklar</Link> sayfasından eşleştirme kodu alın.
          </Alert>
        )}
        {s && s.deviceCount > 0 && (
          <>
            <div>
              <div className="row between">
                <span className="muted small">Risk puanı</span>
                <strong style={{ color: riskColor(s.riskScore) }}>%{s.riskScore}</strong>
              </div>
              <RiskBar score={s.riskScore} />
            </div>
            <div className="grid cols-4">
              <div className="stat">
                <div className="value" style={{ fontSize: '1.1rem' }}>
                  {emotionLabel(s.emotion)}
                </div>
                <div className="label">Duygu durumu</div>
              </div>
              <div className="stat">
                <div className="value" style={{ fontSize: '1.1rem', overflowWrap: 'anywhere' }}>
                  {s.windowTitle || '—'}
                </div>
                <div className="label">Açık pencere</div>
              </div>
              <div className="stat">
                <div className="value" style={{ fontSize: '1.1rem' }}>
                  {Math.round(s.audioLevel)}
                </div>
                <div className="label">Ortam ses seviyesi</div>
              </div>
              <div className="stat">
                <div className="value" style={{ fontSize: '1.1rem' }}>
                  {fmtTime(s.lastSeen)}
                </div>
                <div className="label">Son görülme</div>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="grid cols-4" aria-label="Bugünün özeti">
        <div className="card stat">
          <div className="value">{sum ? fmtDuration(sum.screenSeconds) : '—'}</div>
          <div className="label">Bugünkü ekran süresi</div>
        </div>
        <div className="card stat">
          <div className="value">{sum?.eventCount ?? '—'}</div>
          <div className="label">Risk olayı</div>
        </div>
        <div className="card stat">
          <div className="value">{sum?.avgRisk == null ? '—' : `%${sum.avgRisk}`}</div>
          <div className="label">Ortalama risk</div>
        </div>
        <div className="card stat">
          <div className="value">{sum ? `%${sum.maxRisk}` : '—'}</div>
          <div className="label">En yüksek risk</div>
        </div>
      </section>

      <section className="card" aria-label="Son olaylar">
        <div className="row between">
          <h2>Son olaylar</h2>
          <Link to="/gecmis" className="small">
            Tümü →
          </Link>
        </div>
        {events.data?.items.length === 0 && <p className="muted">Henüz kaydedilmiş bir olay yok.</p>}
        {events.data?.items.map((e) => (
          <div className="event" key={e.id}>
            <div className="row between">
              <strong>{e.category}</strong>
              <span className="badge" style={{ color: riskColor(e.score) }}>
                %{e.score}
              </span>
            </div>
            <div className="muted small">{fmtTime(e.occurredAt)}</div>
            <div className="small">{e.details}</div>
          </div>
        ))}
      </section>
    </>
  );
}
