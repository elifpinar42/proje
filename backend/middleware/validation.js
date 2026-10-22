const { body, query, validationResult } = require('express-validator');

// Validation sonuçlarını kontrol eden yardımcı middleware
function validateRequest(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: "Girdi doğrulama hatası", 
            details: errors.array().map(e => `${e.param}: ${e.msg}`) 
        });
    }
    next();
}

// 1. Kayıt Doğrulama Kuralları
const validateRegister = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 30 }).withMessage('Kullanıcı adı 3-30 karakter olmalıdır.')
        .matches(/^[a-zA-Z0-9çğıöşüÇĞİÖŞÜ._\-,!?]+$/).withMessage('Geçersiz kullanıcı adı formatı.'),
    body('password')
        .isLength({ min: 6 }).withMessage('Parola en az 6 karakter olmalıdır.'),
    body('type')
        .optional()
        .isIn(['parent', 'child']).withMessage('Geçersiz kullanıcı rolü.'),
    validateRequest
];

// 2. Giriş Doğrulama Kuralları
const validateLogin = [
    body('username').trim().notEmpty().withMessage('Kullanıcı adı boş bırakılamaz.'),
    body('password').notEmpty().withMessage('Parola boş bırakılamaz.'),
    validateRequest
];

// 3. Şifre Sıfırlama Doğrulama
const validateResetPassword = [
    body('username').trim().notEmpty(),
    body('newPassword').isLength({ min: 6 }),
    validateRequest
];

// 4. 2FA Doğrulama
const validate2FAToken = [
    body('token').trim().isLength({ min: 6, max: 8 }).withMessage('Geçersiz doğrulama kodu.'),
    validateRequest
];

module.exports = {
    validateRegister,
    validateLogin,
    validateResetPassword,
    validate2FAToken
};
