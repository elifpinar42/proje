import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EMOTION_LABELS, type Emotion } from '@dr/shared';
import type { Db } from '../db';
import { buildSummary } from './stats';

function findFont(fontsDir: string | null, file: string): string | null {
  const candidates = [
    fontsDir && join(fontsDir, file),
    join(process.cwd(), 'fonts', file),
    join(process.cwd(), 'apps', 'server', 'fonts', file),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
}

export function buildReportPdf(
  db: Db,
  fontsDir: string | null,
  child: { id: string; name: string },
  days: number,
  tzOffsetMin = 0,
): Promise<Buffer> {
  const summary = buildSummary(db, child.id, days, tzOffsetMin);
  const since = Date.now() - days * 86_400_000;
  const events = db.all<{
    occurred_at: number;
    title: string;
    details: string;
    score: number;
    category: string;
  }>(
    `SELECT occurred_at, title, details, score, category FROM events
     WHERE child_id = ? AND occurred_at >= ? ORDER BY occurred_at DESC LIMIT 60`,
    child.id,
    since,
  );

  const regular = findFont(fontsDir, 'DejaVuSans.ttf');
  const bold = findFont(fontsDir, 'DejaVuSans-Bold.ttf');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Rapor - ${child.name}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (regular && bold) {
      doc.registerFont('R', regular);
      doc.registerFont('B', bold);
    } else {
      // Yazı tipi dosyaları bulunamazsa Türkçe karakterler bozuk çıkabilir.
      doc.registerFont('R', 'Helvetica');
      doc.registerFont('B', 'Helvetica-Bold');
    }

    doc.font('B').fontSize(20).fillColor('#1e1b4b').text('Dijital Rehberlik — Çocuk Raporu');
    doc.moveDown(0.3);
    doc
      .font('R')
      .fontSize(11)
      .fillColor('#475569')
      .text(`Çocuk: ${child.name}   •   Dönem: son ${days} gün   •   Oluşturma: ${fmtDate(Date.now())}`);
    doc.moveDown();

    doc.font('B').fontSize(14).fillColor('#1e1b4b').text('Özet');
    doc.font('R').fontSize(11).fillColor('#0f172a');
    doc.text(`Ekran süresi: ${fmtDuration(summary.screenSeconds)}`);
    doc.text(`Risk olayı sayısı: ${summary.eventCount}`);
    doc.text(
      summary.avgRisk === null
        ? 'Ortalama risk: veri yok'
        : `Ortalama risk: %${summary.avgRisk}   •   En yüksek risk: %${summary.maxRisk}`,
    );
    doc.moveDown();

    doc.font('B').fontSize(14).fillColor('#1e1b4b').text('Duygu dağılımı');
    doc.font('R').fontSize(11).fillColor('#0f172a');
    const total = Object.values(summary.emotionCounts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      doc.text('Bu dönemde duygu verisi toplanmadı (kamera kapalı olabilir).');
    } else {
      for (const [emo, n] of Object.entries(summary.emotionCounts).sort((a, b) => b[1] - a[1])) {
        const label = EMOTION_LABELS[emo as Emotion] ?? emo;
        doc.text(`${label}: %${Math.round((n / total) * 100)}`);
      }
    }
    doc.moveDown();

    doc.font('B').fontSize(14).fillColor('#1e1b4b').text('Günlük ekran süresi');
    doc.font('R').fontSize(11).fillColor('#0f172a');
    for (const d of summary.daily) {
      doc.text(`${d.date}: ${fmtDuration(d.screenSeconds)}  •  ${d.events} olay`);
    }
    doc.moveDown();

    doc.font('B').fontSize(14).fillColor('#1e1b4b').text('Risk olayları');
    doc.font('R').fontSize(10).fillColor('#0f172a');
    if (events.length === 0) {
      doc.text('Bu dönemde risk olayı kaydedilmedi.');
    } else {
      for (const e of events) {
        doc.font('B').text(`${fmtDate(e.occurred_at)}  •  %${e.score}  •  ${e.category}`);
        doc.font('R').text(e.details, { indent: 10 });
        doc.moveDown(0.4);
      }
    }
    doc.end();
  });
}
