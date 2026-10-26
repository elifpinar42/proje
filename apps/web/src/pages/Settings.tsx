import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type ChildSettings } from '@dr/shared';
import { api } from '../api';
import { useSession } from '../session';
import { Alert, ChildPicker, NoChild, PageHeader, errMsg } from '../ui';

type BoolKey = 'screenEnabled' | 'keyboardEnabled' | 'cameraEnabled' | 'micEnabled' | 'notifyParentOnRisk' | 'autostart';

const TOGGLES: { key: BoolKey; title: string; text: string }[] = [
  { key: 'screenEnabled', title: 'Pencere / ekran başlığı izleme', text: 'Açık pencerenin başlığına bakar; sakıncalı kelimeler (ör. kumar, bahis) geçerse risk puanını yükseltir. Ekran görüntüsü alınmaz.' },
  { key: 'keyboardEnabled', title: 'Klavye hızı izleme', text: 'Yalnızca tuşlama hızını ölçer (panik/öfke tespiti). Yazılan harfler kaydedilmez ve gönderilmez.' },
  { key: 'cameraEnabled', title: 'Kamera ile duygu analizi', text: 'Kamera görüntüsü cihaz üzerinde işlenir ve cihazdan çıkmaz; yalnızca duygu etiketi (ör. “üzgün”) gönderilir.' },
  { key: 'micEnabled', title: 'Mikrofon ile ortam sesi seviyesi', text: 'Yalnızca göreli ses yüksekliği ölçülür. Ses kaydedilmez ve gönderilmez.' },
  { key: 'autostart', title: 'Çocuk bilgisayarında otomatik başlat', text: 'Bilgisayar açılınca uygulama kendiliğinden (gizli) başlar. Bu ayarı yalnızca siz değiştirebilirsiniz.' },
  { key: 'notifyParentOnRisk', title: 'Risk olaylarını bana bildir', text: 'Risk eşiği aşıldığında olay kaydı oluşturulur ve panelde canlı gösterilir.' },
];

export function Settings() {
  const { childId, children } = useSession();
  const [s, setS] = useState<ChildSettings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!childId) return;
    setMsg('');
    api
      .get<ChildSettings>(`/children/${childId}/settings`)
      .then(setS)
      .catch((e) => setError(errMsg(e)));
  }, [childId]);

  if (children.length === 0) return <NoChild />;

  async function save() {
    try {
      setS(await api.put<ChildSettings>(`/children/${childId}/settings`, s));
      setMsg('Ayarlar kaydedildi. Çocuk cihazı bir sonraki bağlantıda yeni ayarları alır.');
      setError('');
    } catch (e) {
      setError(errMsg(e));
      setMsg('');
    }
  }

  return (
    <>
      <PageHeader title="Ayarlar" subtitle="Çocuk cihazında hangi sinyallerin toplanacağına siz karar verirsiniz.">
        <ChildPicker />
      </PageHeader>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <section className="card">
        <h2>İzinler</h2>
        {TOGGLES.map((t) => (
          <label className="toggle" key={t.key}>
            <input type="checkbox" checked={s[t.key]} onChange={(e) => setS({ ...s, [t.key]: e.target.checked })} />
            <span>
              <strong>{t.title}</strong>
              <br />
              <span className="muted small">{t.text}</span>
            </span>
          </label>
        ))}
      </section>
      <section className="card stack">
        <h2>Hassasiyet ve saklama</h2>
        <label className="field">
          Risk hassasiyeti
          <select value={s.sensitivity} onChange={(e) => setS({ ...s, sensitivity: e.target.value as ChildSettings['sensitivity'] })}>
            <option value="low">Düşük — yalnızca belirgin riskler (eşik %70)</option>
            <option value="medium">Orta — dengeli (eşik %60)</option>
            <option value="high">Yüksek — erken uyarı (eşik %50)</option>
          </select>
        </label>
        <label className="field">
          Verileri saklama süresi (gün)
          <input type="number" min={1} max={3650} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Number(e.target.value) })} />
        </label>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={save}>
          Kaydet
        </button>
      </section>
    </>
  );
}
