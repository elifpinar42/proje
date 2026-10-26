import { useEffect, useState } from 'react';
import { api, type EventItem } from '../api';
import { useSession } from '../session';
import { Alert, ChildPicker, NoChild, PageHeader, emotionLabel, errMsg, fmtTime, riskColor } from '../ui';

const PAGE = 30;

export function History() {
  const { childId, children } = useSession();
  const [days, setDays] = useState(7);
  const [minScore, setMinScore] = useState(0);
  const [source, setSource] = useState('');
  const [items, setItems] = useState<EventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  async function load(offset: number) {
    if (!childId) return;
    const from = Date.now() - days * 86_400_000;
    const q = new URLSearchParams({ from: String(from), minScore: String(minScore), limit: String(PAGE), offset: String(offset) });
    if (source) q.set('source', source);
    try {
      const res = await api.get<{ items: EventItem[]; total: number }>(`/children/${childId}/events?${q}`);
      setItems((cur) => (offset === 0 ? res.items : [...cur, ...res.items]));
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  useEffect(() => {
    setItems([]);
    load(0);
  }, [childId, days, minScore, source]);

  if (children.length === 0) return <NoChild />;

  return (
    <>
      <PageHeader title="Geçmiş" subtitle={`${total} kayıt`}>
        <ChildPicker />
      </PageHeader>
      <div className="card row">
        <label className="field" style={{ minWidth: 140 }}>
          Dönem
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Son 24 saat</option>
            <option value={7}>Son 7 gün</option>
            <option value={30}>Son 30 gün</option>
            <option value={365}>Son 1 yıl</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 140 }}>
          Asgari risk
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
            <option value={0}>Hepsi</option>
            <option value={50}>%50 ve üzeri</option>
            <option value={75}>%75 ve üzeri</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 140 }}>
          Kaynak
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Hepsi</option>
            <option value="risk">Cihaz izleme</option>
            <option value="chat">Sohbet uyarıları</option>
          </select>
        </label>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="card">
        {items.length === 0 && <p className="muted">Bu filtrelerle eşleşen kayıt yok.</p>}
        {items.map((e) => (
          <article className="event" key={e.id}>
            <div className="row between">
              <strong>{e.title}</strong>
              <span className="badge" style={{ color: riskColor(e.score) }}>
                %{e.score}
              </span>
            </div>
            <div className="muted small">
              {fmtTime(e.occurredAt)} • {e.category} {e.source === 'chat' && '• Sohbet'}
            </div>
            <p className="small">{e.details}</p>
            {e.windowTitle && <p className="muted small">Pencere: {e.windowTitle}</p>}
            {e.source === 'risk' && <p className="muted small">Duygu: {emotionLabel(e.emotion)}</p>}
          </article>
        ))}
        {items.length < total && (
          <button className="btn ghost" onClick={() => load(items.length)}>
            Daha fazla göster
          </button>
        )}
      </div>
    </>
  );
}
