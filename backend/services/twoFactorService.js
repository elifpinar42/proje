const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { encrypt, decrypt } = require('../utils/encryption');

/**
 * 2FA TOTP Secret & Recovery Codes Üretme
 */
async function generate2FASecret(username) {
    const secret = speakeasy.generateSecret({
        name: `Dijital Rehberlik (${username})`,
        length: 20
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // 8 Adet Tek Kullanımlık Kurtarma Kodu Üret (Recovery Codes)
    const rawRecoveryCodes = Array.from({ length: 8 }, () => 
        crypto.randomBytes(4).toString('hex').toUpperCase()
    );

    return {
        otpauthUrl: secret.otpauth_url,
        qrCodeUrl,
        rawSecret: secret.base32,
        encryptedSecret: encrypt(secret.base32),
        rawRecoveryCodes,
        encryptedRecoveryCodes: rawRecoveryCodes.map(code => encrypt(code))
    };
}

/**
 * TOTP Kodunu Doğrulama
 */
function verify2FACode(encryptedSecret, tokenCode) {
    const decryptedSecret = decrypt(encryptedSecret);
    if (!decryptedSecret) return false;

    return speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: tokenCode,
        window: 1 // 30 saniye esneklik (zaman senkronizasyon töleransı)
    });
}

/**
 * Kurtarma Kodu İle Giriş Doğrulama
 */
function verifyRecoveryCode(encryptedRecoveryCodes, inputCode) {
    if (!Array.isArray(encryptedRecoveryCodes)) return { valid: false };

    const upperInput = (inputCode || '').trim().toUpperCase();
    
    for (let i = 0; i < encryptedRecoveryCodes.length; i++) {
        const decryptedCode = decrypt(encryptedRecoveryCodes[i]);
        if (decryptedCode && decryptedCode === upperInput) {
            // Kullanılan kurtarma kodunu listeden çıkar
            const remainingCodes = [...encryptedRecoveryCodes];
            remainingCodes.splice(i, 1);
            return { valid: true, remainingCodes };
        }
    }
    return { valid: false };
}

module.exports = {
    generate2FASecret,
    verify2FACode,
    verifyRecoveryCode
};
