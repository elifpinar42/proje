const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// 1. Hassas Giriş ve Kayıt İşlemleri İçin Sıkı Rate Limiting (Brute-Force Koruması)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 dakika
    max: 10, // 15 dakikada en fazla 10 deneme
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Çok fazla hatalı giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.' }
});

// 2. Genel API Endpointleri İçin Rate Limiting (DoS Koruması)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 dakika
    max: 200, // 15 dakikada 200 istek
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'API istek limitine ulaştınız. Lütfen bir süre sonra tekrar deneyin.' }
});

// 3. Şifre Sıfırlama İstekleri İçin Özel Limit
const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 saat
    max: 5, // Saatte en fazla 5 şifre sıfırlama denemesi
    message: { error: 'Şifre sıfırlama sınırını aştınız. Lütfen daha sonra tekrar deneyin.' }
});

// 4. Güvenlik Header Yapılandırması (Helmet & CSP & XSS & Clickjacking)
const securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", "http://localhost:3000", "http://127.0.0.1:3000"]
        }
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' }, // Clickjacking engelleme
    noSniff: true, // MIME type sniffing engelleme
    xssFilter: true // XSS Filtresi
});

// 5. Girdi Temizleme / Sanitize (XSS & Injection Önleme)
function sanitizeInput(req, res, next) {
    const sanitizeValue = (val) => {
        if (typeof val === 'string') {
            // Zararlı script etiketlerini ve karakterleri temizle
            return val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        return val;
    };

    if (req.body && typeof req.body === 'object') {
        for (let key in req.body) {
            req.body[key] = sanitizeValue(req.body[key]);
        }
    }
    if (req.query && typeof req.query === 'object') {
        for (let key in req.query) {
            req.query[key] = sanitizeValue(req.query[key]);
        }
    }
    next();
}

module.exports = {
    authLimiter,
    apiLimiter,
    resetLimiter,
    securityHeaders,
    sanitizeInput
};
