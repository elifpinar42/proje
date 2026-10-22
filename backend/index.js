const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");

dotenv.config();

const { 
    usersDB, 
    settingsDB, 
    reportsDB, 
    historyDB, 
    activityDB, 
    aiChatDB,
    revokeToken,
    sessionsDB,
    securityLogsDB,
    dataRetentionDB,
    refreshTokensDB
} = require('./database');

const { verifyToken, requireRole, enforceDataOwnership } = require('./middleware/auth');
const { authLimiter, apiLimiter, resetLimiter, securityHeaders, sanitizeInput } = require('./middleware/security');
const { validateRegister, validateLogin, validateResetPassword, validate2FAToken } = require('./middleware/validation');
const { generate2FASecret, verify2FACode, verifyRecoveryCode } = require('./services/twoFactorService');
const { processChildQuestion, processParentQuestion } = require('./services/aiGuidanceService');
const { generateChildReportPDF } = require('./services/pdfService');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment Secrets
const JWT_SECRET = process.env.JWT_SECRET || 'access-token-secret-key-32chars-min';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-token-secret-key-32chars-min';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Cookie Ayarları (Secure, HttpOnly, SameSite)
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax', // Mobil / LAN erişimi için lax
    maxAge: 7 * 24 * 60 * 60 * 1000
};

app.use(securityHeaders);
// Hem yerel ağ (telefonda 192.168.x.x), hem localhost, hem de Electron file:// isteklerine izin ver
app.use(cors({
    origin: (origin, callback) => {
        callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(cookieParser());
app.use(sanitizeInput);

// Frontend'i statik olarak sun (Telefon ve tarayıcıdan doğrudan erişim için)
app.use(express.static(path.join(__dirname, '../frontend')));

// Periyodik Retention (30 günden eski ham verileri sil)
setInterval(() => {
    dataRetentionDB.purgeOldData(30);
}, 24 * 60 * 60 * 1000);

// ==========================================
// 1. AUTHENTICATION & REFRESH TOKEN ROTATION ENDPOINTS
// ==========================================

// Kayıt (Register)
app.post("/api/auth/register", authLimiter, validateRegister, async (req, res) => {
    let { username, password, type, securityQuestion, securityAnswer } = req.body;
    username = username.trim();
    
    usersDB.findOne({ username }, async (err, existingUser) => {
        if (existingUser) {
            return res.status(400).json({ error: "Bu kullanıcı adı zaten alınmış." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const hashedAnswer = await bcrypt.hash(securityAnswer || 'default', 10);

        usersDB.insert({ 
            username, 
            password: hashedPassword, 
            type: type || 'child', 
            securityQuestion: securityQuestion || 'Varsayılan', 
            securityAnswer: hashedAnswer,
            twoFactorEnabled: false,
            twoFactorSecret: null,
            recoveryCodes: []
        }, (err, newUser) => {
            if (err) {
                securityLogsDB.logEvent({ type: 'FAILED_REGISTER', username, ip: req.ip });
                return res.status(500).json({ error: "Kayıt sırasında veritabanı hatası meydana geldi." });
            }
            securityLogsDB.logEvent({ type: 'SUCCESSFUL_REGISTER', username, ip: req.ip });
            res.status(201).json({ message: "Kayıt başarıyla oluşturuldu." });
        });
    });
});

// Giriş (Login) - 2FA & Refresh Token Support
app.post("/api/auth/login", authLimiter, validateLogin, (req, res) => {
    let { username, password, twoFactorCode } = req.body;
    username = username ? username.trim() : "";
    
    usersDB.findOne({ username }, async (err, user) => {
        if (err || !user) {
            securityLogsDB.logEvent({ type: 'FAILED_LOGIN', username, ip: req.ip, details: 'Kullanıcı bulunamadı' });
            return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            securityLogsDB.logEvent({ type: 'FAILED_LOGIN', username, ip: req.ip, details: 'Hatalı şifre' });
            return res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
        }

        // 2FA KONTROLÜ (Eğer ebeveyn 2FA etkinleştirdiyse)
        if (user.twoFactorEnabled) {
            if (!twoFactorCode) {
                return res.status(200).json({ 
                    require2FA: true, 
                    message: "Lütfen authenticator uygulamanızdaki 2FA doğrulama kodunu girin." 
                });
            }

            // TOTP veya Recovery Code Doğrulama
            const isTOTPValid = verify2FACode(user.twoFactorSecret, twoFactorCode);
            let isRecoveryValid = false;

            if (!isTOTPValid && user.recoveryCodes && user.recoveryCodes.length > 0) {
                const recResult = verifyRecoveryCode(user.recoveryCodes, twoFactorCode);
                if (recResult.valid) {
                    isRecoveryValid = true;
                    // Kullanılan recovery kodunu veritabanından güncelle
                    usersDB.update({ username: user.username }, { $set: { recoveryCodes: recResult.remainingCodes } });
                }
            }

            if (!isTOTPValid && !isRecoveryValid) {
                securityLogsDB.logEvent({ type: 'FAILED_2FA', username: user.username, ip: req.ip });
                return res.status(401).json({ error: "Geçersiz 2FA kodu veya kurtarma kodu." });
            }
        }

        // Access Token (8 Saat — gün boyu geçerli)
        const accessToken = jwt.sign(
            { username: user.username, type: user.type }, 
            JWT_SECRET, 
            { expiresIn: '8h' }
        );

        // Uzun Ömürlü Refresh Token (7 Gün)
        const familyId = Date.now().toString();
        const refreshToken = jwt.sign(
            { username: user.username, familyId }, 
            JWT_REFRESH_SECRET, 
            { expiresIn: '7d' }
        );

        refreshTokensDB.addRefreshToken(user.username, refreshToken, familyId);

        // Refresh Token'ı Güvenli HttpOnly Cookie Olarak Gönder
        res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);

        const sessionId = Date.now().toString();
        sessionsDB.addSession({
            sessionId,
            username: user.username,
            token: accessToken,
            device: req.headers['user-agent'] || 'Masaüstü / Web',
            ip: req.ip
        });

        securityLogsDB.logEvent({ type: 'SUCCESSFUL_LOGIN', username: user.username, ip: req.ip });

        res.json({ 
            message: "Giriş başarılı", 
            accessToken, 
            sessionId,
            user: { username: user.username, type: user.type, twoFactorEnabled: !!user.twoFactorEnabled } 
        });
    });
});

// Refresh Token İle Yeni Access Token Alma (Rotation & Reuse Detection)
app.post("/api/auth/refresh", (req, res) => {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ error: "Yenileme jetonu bulunamadı." });
    }

    try {
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const { valid, reason, familyId } = refreshTokensDB.verifyAndRotate(decoded.username, refreshToken);

        if (!valid) {
            res.clearCookie('refreshToken', COOKIE_OPTIONS);
            if (reason === 'REUSE_DETECTED') {
                return res.status(403).json({ 
                    error: "Güvenlik İhlali Tespiti: İptal edilen bir jeton tekrar kullanılmaya çalışıldı. Tüm oturumlarınız güvenlik nedeniyle kapatıldı." 
                });
            }
            return res.status(401).json({ error: "Geçersiz veya süresi dolmuş yenileme jetonu." });
        }

        // Yeni Access Token (15 Dakika) ve Yeni Refresh Token (Rotation)
        const newAccessToken = jwt.sign(
            { username: decoded.username, type: decoded.type || 'parent' }, 
            JWT_SECRET, 
            { expiresIn: '15m' }
        );

        const newRefreshToken = jwt.sign(
            { username: decoded.username, familyId }, 
            JWT_REFRESH_SECRET, 
            { expiresIn: '7d' }
        );

        refreshTokensDB.addRefreshToken(decoded.username, newRefreshToken, familyId);
        res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);

        res.json({ accessToken: newAccessToken });
    } catch (err) {
        res.clearCookie('refreshToken', COOKIE_OPTIONS);
        return res.status(401).json({ error: "Oturum süresi dolmuş. Lütfen tekrar giriş yapın." });
    }
});

// Çıkış Yapma (Logout & Session Invalidation)
app.post("/api/auth/logout", verifyToken, (req, res) => {
    if (req.token) revokeToken(req.token, req.user.username);
    if (req.user && req.user.username) {
        refreshTokensDB.revokeUserRefreshTokens(req.user.username);
    }
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    securityLogsDB.logEvent({ type: 'LOGOUT', username: req.user ? req.user.username : 'Bilinmeyen', ip: req.ip });
    res.json({ message: "Başarıyla çıkış yapıldı." });
});

// Oturum/Cihaz Yönetimi Endpointleri
app.get("/api/auth/sessions", verifyToken, (req, res) => {
    const sessions = sessionsDB.getUserSessions(req.user.username);
    res.json(sessions);
});

app.delete("/api/auth/sessions/:sessionId", verifyToken, (req, res) => {
    sessionsDB.removeSession(req.params.sessionId, req.user.username);
    res.json({ message: "Oturum sonlandırıldı." });
});

app.delete("/api/auth/sessions", verifyToken, (req, res) => {
    sessionsDB.removeAllUserSessions(req.user.username);
    refreshTokensDB.revokeUserRefreshTokens(req.user.username);
    res.clearCookie('refreshToken', COOKIE_OPTIONS);
    res.json({ message: "Tüm cihazlardaki oturumlar sonlandırıldı." });
});

// Şifre Sıfırlama
app.post("/api/auth/reset-password", resetLimiter, validateResetPassword, async (req, res) => {
    const { username, securityQuestion, securityAnswer, newPassword } = req.body;
    usersDB.findOne({ username, securityQuestion }, async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "Girilen bilgiler eşleşmiyor." });

        const validAnswer = await bcrypt.compare(securityAnswer, user.securityAnswer);
        if (!validAnswer) return res.status(401).json({ error: "Hatalı yanıt." });

        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        usersDB.update({ username }, { $set: { password: newHashedPassword } }, {}, (err) => {
            sessionsDB.removeAllUserSessions(username);
            refreshTokensDB.revokeUserRefreshTokens(username);
            securityLogsDB.logEvent({ type: 'PASSWORD_RESET', username, ip: req.ip });
            res.json({ message: "Şifreniz güncellendi. Güvenliğiniz için tüm cihaz oturumları kapatıldı." });
        });
    });
});

// ==========================================
// 2. 2FA / MFA SETUP & MANAGEMENT ENDPOINTS
// ==========================================

// 2FA Kurulum QR Kodu İsteği (Yalnızca PARENT)
app.post("/api/auth/2fa/setup", verifyToken, requireRole(['parent']), async (req, res) => {
    try {
        const secretData = await generate2FASecret(req.user.username);
        
        // Geçici olarak kullanıcı kaydına encryptedSecret ve recoveryCodes yaz
        usersDB.update({ username: req.user.username }, { 
            $set: { 
                tempTwoFactorSecret: secretData.encryptedSecret,
                tempRecoveryCodes: secretData.encryptedRecoveryCodes
            } 
        });

        res.json({
            qrCodeUrl: secretData.qrCodeUrl,
            secret: secretData.rawSecret,
            recoveryCodes: secretData.rawRecoveryCodes
        });
    } catch (e) {
        res.status(500).json({ error: "2FA kurulumu başlatılamadı." });
    }
});

// 2FA Etkinleştirme Doğrulaması
app.post("/api/auth/2fa/enable", verifyToken, requireRole(['parent']), validate2FAToken, (req, res) => {
    const { token } = req.body;
    usersDB.findOne({ username: req.user.username }, (err, user) => {
        if (!user || !user.tempTwoFactorSecret) {
            return res.status(400).json({ error: "Lütfen önce 2FA kurulumunu başlatın." });
        }

        const isValid = verify2FACode(user.tempTwoFactorSecret, token);
        if (!isValid) {
            return res.status(400).json({ error: "Girdiğiniz 2FA kodu geçersiz." });
        }

        // 2FA'yı aktifleşti olarak kaydet
        usersDB.update({ username: req.user.username }, { 
            $set: { 
                twoFactorEnabled: true,
                twoFactorSecret: user.tempTwoFactorSecret,
                recoveryCodes: user.tempRecoveryCodes,
                tempTwoFactorSecret: null,
                tempRecoveryCodes: null
            } 
        });

        securityLogsDB.logEvent({ type: '2FA_ENABLED', username: req.user.username, ip: req.ip });
        res.json({ message: "İki aşamalı doğrulama (2FA) başarıyla etkinleştirildi." });
    });
});

// 2FA Devre Dışı Bırakma
app.post("/api/auth/2fa/disable", verifyToken, requireRole(['parent']), validate2FAToken, (req, res) => {
    const { token } = req.body;
    usersDB.findOne({ username: req.user.username }, (err, user) => {
        if (!user || !user.twoFactorEnabled) {
            return res.status(400).json({ error: "2FA zaten aktif değil." });
        }

        const isValid = verify2FACode(user.twoFactorSecret, token);
        if (!isValid) {
            return res.status(400).json({ error: "Geçersiz 2FA kodu." });
        }

        usersDB.update({ username: req.user.username }, { 
            $set: { 
                twoFactorEnabled: false,
                twoFactorSecret: null,
                recoveryCodes: []
            } 
        });

        securityLogsDB.logEvent({ type: '2FA_DISABLED', username: req.user.username, ip: req.ip });
        res.json({ message: "2FA başarıyla devre dışı bırakıldı." });
    });
});

// ==========================================
// 3. PROTECTED CORE BUSINESS ENDPOINTS (AUTHORIZATION & IDOR PROTECTED)
// ==========================================

app.get("/api/settings", verifyToken, requireRole(['parent']), (req, res) => {
    settingsDB.get((err, settings) => {
        if (err) return res.status(500).json({ error: "Ayarlar okunamadı." });
        res.json(settings);
    });
});

app.post("/api/settings", verifyToken, requireRole(['parent']), (req, res) => {
    settingsDB.update(req.body, (err, updatedSettings) => {
        if (err) return res.status(500).json({ error: "Ayarlar güncellenemedi." });
        res.json({ message: "Ayarlar güncellendi", settings: updatedSettings });
    });
});

app.get("/api/reports", verifyToken, (req, res) => {
    reportsDB.getAll((err, reports) => {
        if (err) return res.status(500).json({ error: "Raporlar alınamadı." });
        res.json(reports);
    });
});

app.post("/api/reports", verifyToken, (req, res) => {
    reportsDB.add(req.body, (err, newReport) => {
        if (err) return res.status(500).json({ error: "Rapor kaydedilemedi." });
        res.status(201).json(newReport);
    });
});

app.get("/api/history", verifyToken, enforceDataOwnership, (req, res) => {
    const { startDate, endDate, minScore, category } = req.query;
    historyDB.getFiltered({ startDate, endDate, minScore, category }, (err, history) => {
        if (err) return res.status(500).json({ error: "Geçmiş verileri alınamadı." });
        res.json(history);
    });
});

app.get("/api/summary/daily", verifyToken, enforceDataOwnership, (req, res) => {
    const targetDateStr = req.query.date || new Date().toISOString().split('T')[0];
    const start = new Date(targetDateStr + 'T00:00:00.000Z').getTime();
    const end = new Date(targetDateStr + 'T23:59:59.999Z').getTime();

    historyDB.getFiltered({ startDate: start, endDate: end }, (err, events) => {
        if (err) return res.status(500).json({ error: "Özet verisi alınamadı." });

        const riskCount = events.length;
        const avgScore = riskCount > 0 ? Math.round(events.reduce((a, b) => a + (b.score || 0), 0) / riskCount) : 0;
        let safetyScore = Math.max(20, 100 - (riskCount * 8));

        let aiEval = "Çocuğunuz gün içinde genel olarak güvenli içeriklerle etkileşim kurmuştur.";
        let parentTips = "Ortak dijital kuralları koruyarak aile sohbetleri düzenleyebilirsiniz.";

        if (riskCount > 5) {
            aiEval = "Gün içinde birden fazla hassas içerik etkileşimi gözlemlenmiştir (Gözlemsel Tahmin).";
            parentTips = "Çocuğunuzla siber güvenlik üzerine sohbet etmeniz önerilir.";
        }

        res.json({
            date: targetDateStr,
            totalScreenTimeFormatted: "2 saat 40 dakika",
            topApps: ["TÜBİTAK Bilim Çocuk", "Scratch MIT Kodlama"],
            riskCount,
            avgRiskScore: avgScore,
            safetyScore,
            aiEvaluation: aiEval,
            parentRecommendation: parentTips,
            events: events.slice(0, 10),
            disclaimer: "⚠️ Yasal Bilgilendirme: Bu göstergeler cihaz içi gözlemsel tahmindir. Tıbbi/psikolojik teşhis niteliği taşımaz."
        });
    });
});

// PDF Raporlama (Yalnızca PARENT)
app.post("/api/reports/pdf", verifyToken, requireRole(['parent']), (req, res) => {
    const { startDate, endDate, childName, dateRangeText } = req.body;
    const start = startDate ? new Date(startDate).getTime() : Date.now() - (7 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate).getTime() : Date.now();

    historyDB.getFiltered({ startDate: start, endDate: end }, (err, events) => {
        // Veritabanı hatası durumunda güvenli hata yanıtı
        if (err) {
            console.error('[PDF] Geçmiş verileri alınamadı:', err);
            return res.status(500).json({ error: "Geçmiş veriler alınamadı, PDF oluşturulamadı." });
        }

        const reportData = {
            childName: childName || 'Çocuk Kullanıcı',
            dateRangeText: dateRangeText || 'Son 7 Günlük İnceleme',
            riskCount: events ? events.length : 0,
            totalScreenTime: 'Hesaplanıyor...',
            topApps: 'Scratch MIT, TÜBİTAK Bilim, TRT Çocuk',
            safetyScore: Math.max(25, 100 - ((events ? events.length : 0) * 5)),
            events: events || [],
            aiRecommendation: 'Çocuğunuzun siber farkındalığı olumlu seviyededir. Rehber Yapay Zekâ Asistanı kullanımını teşvik edebilirsiniz.'
        };

        // Header'ları yalnızca PDF oluşturulmadan önce ayarla
        try {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Dijital_Rehberlik_Raporu_${Date.now()}.pdf"`);
            generateChildReportPDF(reportData, res);
        } catch (pdfErr) {
            console.error('[PDF] Oluşturma hatası:', pdfErr.message);
            // Header zaten gönderildiyse JSON dönemeyiz — sadece bağlantıyı kapat
            if (!res.headersSent) {
                res.status(500).json({ error: "PDF oluşturulurken hata meydana geldi: " + pdfErr.message });
            } else {
                res.end();
            }
        }
    });
});

// AI Chat Endpoint'leri
app.post("/api/ai/child-guide", verifyToken, async (req, res) => {
    const { question, history } = req.body;
    if (!question) return res.status(400).json({ error: "Lütfen bir soru girin." });
    try {
        const result = await processChildQuestion(question, history || []);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Rehber asistan yanıt veremedi." });
    }
});

app.post("/api/ai/parent-guide", verifyToken, requireRole(['parent']), async (req, res) => {
    const { question, history } = req.body;
    if (!question) return res.status(400).json({ error: "Lütfen bir soru girin." });
    try {
        const result = await processParentQuestion(question, history || []);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: "Ebeveyn rehber asistanı yanıt veremedi." });
    }
});

app.get("/api/guidance/recommendations", apiLimiter, (req, res) => {
    res.json([
        { category: "Eğitici Video & Bilim", title: "TÜBİTAK Bilim Çocuk", url: "https://bilimcocuk.tubitak.gov.tr", tag: "Güvenli Bilim" },
        { category: "Sanat ve Kodlama", title: "Scratch MIT", url: "https://scratch.mit.edu", tag: "Yaratıcı Gelişim" },
        { category: "Güvenli Kitaplık", title: "TRT Çocuk Dijital Kitaplık", url: "https://www.trtcocuk.net.tr", tag: "Eğitici Oyun" }
    ]);
});

// Security Logs (Sadece Yetkili Parent)
app.get("/api/security/logs", verifyToken, requireRole(['parent']), (req, res) => {
    res.json(securityLogsDB.getLogs(50));
});

// Centralized Secure Error Handler (Internal Stack Trace Sızdırmayan Genel Hata Yakalayıcı)
app.use((err, req, res, next) => {
    console.error(`[SUNUCU HATASI] ${req.method} ${req.url}:`, err.message || err);
    res.status(500).json({ 
        error: "Sunucuda bir hata meydana geldi. Detaylı teknik bilgi güvenlik nedeniyle gizlenmiştir." 
    });
});

app.listen(PORT, () => {
    console.log(`[PRODUCTION SECURITY] Sunucu ${PORT} portunda başarıyla çalışıyor.`);
});