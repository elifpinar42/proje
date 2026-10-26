import { describe, expect, it } from 'vitest';
import {
  EMPTY_RISK_STATE,
  checkChildMessage,
  computeRisk,
  keyboardRiskFromCount,
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
    expect(computeRisk({ ...EMPTY_RISK_STATE, windowRisk: 85 })).toBe(50);
  });

  it('hassasiyet ayarı gerçekten uygulanır', () => {
    const s = { ...EMPTY_RISK_STATE, windowRisk: 85 };
    expect(computeRisk(s, 'low')).toBeLessThan(computeRisk(s, 'medium'));
    expect(computeRisk(s, 'high')).toBeGreaterThan(computeRisk(s, 'medium'));
  });

  it('klavye riski tuş sayısıyla artar', () => {
    expect(keyboardRiskFromCount(0)).toBe(0);
    expect(keyboardRiskFromCount(25)).toBe(80);
    expect(keyboardRiskFromCount(500)).toBe(100);
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
