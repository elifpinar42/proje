import { describe, expect, it } from 'vitest';
import {
  EMPTY_RISK_STATE,
  checkChildMessage,
  computeRisk,
  keyboardRiskFromCount,
  riskiestWindow,
  windowRiskFromTitle,
} from '../src';

describe('risk motoru', () => {
  it('boş durum 0 puan verir', () => {
    expect(computeRisk(EMPTY_RISK_STATE)).toBe(0);
  });

  it('sakıncalı pencere başlığı yüksek içerik riski üretir', () => {
    expect(windowRiskFromTitle('Canlı Bahis - Chrome')).toBe(85);
    expect(windowRiskFromTitle('KUMAR sitesi')).toBe(85);
    expect(windowRiskFromTitle('Matematik ödevi')).toBe(0);
  });

  it('puanlar ağırlıklara göre toplanır ve 100 ile sınırlanır', () => {
    const s = { ...EMPTY_RISK_STATE, windowRisk: 85, audioRisk: 85, emotion: 'angry' as const, keyboardRisk: 100 };
    expect(computeRisk(s)).toBe(Math.min(100, Math.round(50 + 22.5 + 25 + 15)));
    expect(computeRisk({ ...EMPTY_RISK_STATE, windowRisk: 85 })).toBe(75);
  });

  it('hassasiyet ayarı gerçekten uygulanır', () => {
    const s = { ...EMPTY_RISK_STATE, windowRisk: 45, emotion: 'angry' as const };
    expect(computeRisk(s, 'low')).toBeLessThan(computeRisk(s, 'medium'));
    expect(computeRisk(s, 'high')).toBeGreaterThan(computeRisk(s, 'medium'));
  });

  it('klavye riski tuş sayısıyla artar', () => {
    expect(keyboardRiskFromCount(0)).toBe(0);
    expect(keyboardRiskFromCount(25)).toBe(80);
    expect(keyboardRiskFromCount(500)).toBe(100);
  });
});

describe('pencere içerik riski', () => {
  it('kendine zarar ve uyuşturucu başlıkları yüksek risk sayılır', () => {
    expect(windowRiskFromTitle('İntihar yöntemleri - Google Chrome')).toBe(85);
    expect(windowRiskFromTitle('uyuşturucu satışı')).toBe(85);
  });
  it('tüm pencereler taranır, en riskli olan seçilir', () => {
    const r = riskiestWindow([{ title: 'Word' }, { title: 'Canlı Bahis | Nesine - Chrome' }, { title: 'Kavga videosu' }]);
    expect(r).toEqual({ title: 'Canlı Bahis | Nesine - Chrome', risk: 85 });
  });
  it('yüksek riskli pencere tek başına her hassasiyette olay eşiğini aşar', () => {
    const s = { ...EMPTY_RISK_STATE, windowRisk: 85 };
    expect(computeRisk(s, 'low')).toBeGreaterThanOrEqual(70);
    expect(computeRisk(s, 'medium')).toBeGreaterThanOrEqual(60);
    expect(computeRisk({ ...EMPTY_RISK_STATE, windowRisk: 45 }, 'medium')).toBeLessThan(60);
  });
});

describe('sohbet güvenlik filtresi', () => {
  it('kriz ifadesini kritik olarak yakalar', () => {
    const hit = checkChildMessage('Ben ölmek istiyorum');
    expect(hit?.severity).toBe('critical');
  });
  it('zararsız mesajı yakalamaz', () => {
    expect(checkChildMessage('Dinozorlar neden yok oldu?')).toBeNull();
  });
});
