const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

/**
 * JWT Token ve Oturum Geçerlilik Doğrulaması
 */
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: 'Yetkilendirme başlığı eksik.' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Erişim jetonu bulunamadı.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Token Karaliste / İptal Kontrolü
        const { isTokenRevoked } = require('../database');
        if (isTokenRevoked && isTokenRevoked(token)) {
            return res.status(401).json({ error: 'Bu oturum sonlandırılmış. Lütfen tekrar giriş yapın.' });
        }

        req.user = decoded;
        req.token = token;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş oturum jetonu.' });
    }
}

/**
 * Rol Tabanlı Erişilebilirlik Kontrolü (RBAC)
 * @param {Array<string>} allowedRoles - İzin verilen roller örn: ['parent'], ['child']
 */
function requireRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.user || !req.user.type) {
            return res.status(403).json({ error: 'Kullanıcı rol bilgisi doğrulanamadı.' });
        }

        const userRole = req.user.type.toLowerCase();
        const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());

        if (!normalizedAllowed.includes(userRole)) {
            return res.status(403).json({ 
                error: 'Erişim engellendi. Bu işlem için gerekli yetkiye sahip değilsiniz.' 
            });
        }
        next();
    };
}

/**
 * Veri Sahipliği ve BOLA/IDOR Engelleme Kontrolü
 * Kullanıcı yalnızca kendi verisine veya yetkili olduğu çocuğun verisine erişebilir.
 */
function enforceDataOwnership(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Yetkisiz erişim.' });
    }

    const requestedUsername = req.query.childUsername || req.body.childUsername || req.params.username;

    // Eğer istekte spesifik bir kullanıcı adı belirtilmişse yetki kontrolü yap
    if (requestedUsername) {
        const isSelf = req.user.username.toLowerCase() === requestedUsername.toLowerCase();
        const isParentOfChild = req.user.type === 'parent' && (req.user.childUsername ? req.user.childUsername.toLowerCase() === requestedUsername.toLowerCase() : true);

        if (!isSelf && !isParentOfChild) {
            return res.status(403).json({ 
                error: 'Güvenlik İhlali: Başka bir kullanıcının veya çocuğun verilerine erişim izniniz yok.' 
            });
        }
    }
    next();
}

module.exports = { verifyToken, requireRole, enforceDataOwnership };
