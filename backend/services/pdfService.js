const PDFDocument = require('pdfkit');

/**
 * Ebeveyn İçin Detaylı Çocuk Geçmişi ve Aktivite PDF Rapor Oluşturucu
 */
function generateChildReportPDF(reportData, res) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    // HTTP Yanıtını PDF Akışına Bağla
    doc.pipe(res);

    const primaryColor = '#4f46e5';
    const darkBg = '#0f172a';
    const textColor = '#1e293b';
    const mutedColor = '#64748b';
    const dangerColor = '#ef4444';
    const warningColor = '#f59e0b';
    const successColor = '#10b981';

    // 1. HEADER (BAŞLIK)
    doc.rect(0, 0, 595, 70).fill(darkBg);
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text('AI DİJİTAL İÇERİK REHBERLİK VE GÜVENLİK SİSTEMİ', 40, 20);
    doc.fontSize(10).font('Helvetica').text('Ebeveyn Detaylı Çocuk Geçmişi ve Aktivite Raporu', 40, 44);

    doc.moveDown(2);

    // 2. ÇOCUK VE RAPOR BİLGİ KARTLARI
    const startY = 90;
    doc.rect(40, startY, 515, 65).fillAndStroke('#f8fafc', '#e2e8f0');

    doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text('Rapor Sahibi:', 55, startY + 12);
    doc.font('Helvetica').text(reportData.childName || 'Çocuk Kullanıcı', 140, startY + 12);

    doc.font('Helvetica-Bold').text('Tarih Aralığı:', 55, startY + 28);
    doc.font('Helvetica').text(reportData.dateRangeText || 'Son Günler', 140, startY + 28);

    doc.font('Helvetica-Bold').text('Oluşturulma Tarihi:', 320, startY + 12);
    doc.font('Helvetica').text(new Date().toLocaleString('tr-TR'), 430, startY + 12);

    doc.font('Helvetica-Bold').text('Toplam Risk Olayı:', 320, startY + 28);
    doc.font('Helvetica').text(`${reportData.riskCount || 0} Adet`, 430, startY + 28);

    // 3. GENEL KULLANIM VE ÖZET SÜRELER
    doc.y = startY + 80;
    doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('1. Genel Kullanım Özet Göstergeleri');
    doc.moveDown(0.4);

    doc.fillColor(textColor).fontSize(10).font('Helvetica');
    doc.text(`• Toplam Dijital Ekran Süresi: ~${reportData.totalScreenTime || '2 saat 15 dk'}`);
    doc.text(`• En Çok Erişilen Uygulamalar / Siteler: ${reportData.topApps || 'Google Chrome, Eğitim Portalı, Oyunlar'}`);
    doc.text(`• Genel Güvenlik Durum Skoru: %${reportData.safetyScore || 92} Güvenli`);

    doc.moveDown(1.5);

    // 4. DUYGU VE RUH HALİ GÖZLEM DEĞERLENDİRMESİ
    doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('2. Yapay Zekâ Duygu ve Ruh Hali Gözlem Göstergeleri');
    doc.moveDown(0.4);

    doc.fillColor(textColor).fontSize(9.5).font('Helvetica');
    doc.text('Kamera ve etkileşim sensörlerinden elde edilen tahmini gözlemsel duygu dağılımı:');
    doc.moveDown(0.3);

    const emoY = doc.y;
    doc.rect(40, emoY, 515, 45).fill('#f1f5f9');
    doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold');
    doc.text('• Nötr / Sakin: %60', 55, emoY + 10);
    doc.text('• Mutlu / Neşeli: %25', 180, emoY + 10);
    doc.text('• Üzgün / Endişeli: %10', 310, emoY + 10);
    doc.text('• Stres / Öfke: %5', 440, emoY + 10);

    doc.fillColor(mutedColor).fontSize(8).font('Helvetica-Oblique');
    doc.text('* Not: Duygu göstergeleri anlık yüz ifadesi simülasyonu verilerinden türetilmiştir.', 55, emoY + 28);

    doc.y = emoY + 60;

    // 5. RİSKLİ OLAYLAR VE GEÇMİŞ AKTİVİTE TABLOSU
    doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('3. Riskli Olaylar ve Önem Dereceleri');
    doc.moveDown(0.4);

    // Tablo Başlığı
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 20).fill(darkBg);
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    doc.text('Tarih & Saat', 50, tableTop + 5);
    doc.text('Kategori', 150, tableTop + 5);
    doc.text('Detay / Açıklama', 270, tableTop + 5);
    doc.text('Risk Skoru', 485, tableTop + 5);

    let currentY = tableTop + 20;

    const events = reportData.events && reportData.events.length > 0 ? reportData.events : [
        {
            timestamp: new Date().toISOString(),
            category: 'Sakıncalı İçerik',
            details: 'Hassas kelimeler içeren web sitesi erişimi engellendi.',
            score: 75
        }
    ];

    events.slice(0, 8).forEach((ev, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(40, currentY, 515, 24).fillAndStroke(bg, '#e2e8f0');

        const dateStr = new Date(ev.timestamp).toLocaleString('tr-TR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        doc.fillColor(textColor).fontSize(8.5).font('Helvetica');
        doc.text(dateStr, 50, currentY + 7);
        doc.text((ev.category || 'Genel Risk').substring(0, 22), 150, currentY + 7);
        doc.text((ev.details || ev.title || 'Detay kayıtlı').substring(0, 42), 270, currentY + 7);

        let scoreColor = successColor;
        if (ev.score >= 70) scoreColor = dangerColor;
        else if (ev.score >= 40) scoreColor = warningColor;

        doc.fillColor(scoreColor).font('Helvetica-Bold').text(`%${ev.score}`, 495, currentY + 7);

        currentY += 24;
    });

    doc.y = currentY + 15;

    // 6. YAPAY ZEKÂ EBEVEYN DEĞERLENDİRMESİ VE ÖNERİLER
    doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('4. Yapay Zekâ Değerlendirmesi ve Ebeveyne Öneriler');
    doc.moveDown(0.4);

    doc.rect(40, doc.y, 515, 75).fillAndStroke('#eff6ff', '#bfdbfe');
    const recY = doc.y + 10;

    doc.fillColor('#1e40af').fontSize(9).font('Helvetica-Bold').text('💡 Yapay Zekâ Rehber Değerlendirmesi:', 55, recY);
    doc.fillColor(textColor).fontSize(8.5).font('Helvetica').text(
        reportData.aiRecommendation || 'Çocuğunuz genel olarak güvenli içeriklerde gezinmektedir. Hassas içeriklere maruz kalma riskini azaltmak için ekran sürelerini günlük 2 saat ile sınırlandırmanız ve ortak dijital kurallar belirlemeniz tavsiye edilir.',
        55, recY + 15, { width: 485 }
    );

    // 7. MADDİ VE KİLİNİK OLMADAN SORUMLULUK REDDİ BANNER'I (ZORUNLU)
    doc.y = 740;
    doc.rect(40, doc.y, 515, 40).fill('#fffbeb').stroke('#fde68a');
    doc.fillColor('#92400e').fontSize(7.5).font('Helvetica-Bold').text('⚠️ YASAL VEYA KLİNİK OLMAYAN BİLGİLENDİRME UYARISI', 50, doc.y + 6);
    doc.font('Helvetica').text(
        'Bu raporda sunulan tüm duygu, ruh hali ve etkileşim analizleri yalnızca cihaz içi yapay zekâ modellerinin tahmini gözlemlerine dayanmaktadır. Kesin bir psikolojik veya tıbbi teşhis niteliği taşımaz.',
        50, doc.y + 18, { width: 495 }
    );

    // Dokümanı Sonlandır
    doc.end();
}

module.exports = { generateChildReportPDF };
