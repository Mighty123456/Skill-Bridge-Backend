/**
 * Decrypt chat messages for admin moderation.
 * Must match the mobile app's EncryptionHelper (AES-256-CBC).
 */
const crypto = require('crypto');

const KEY_UTF8 = 'SkillBridgeSecureChatKey2026!!!!';
const IV_UTF8 = 'FixedIV16Bytes!!';

const key = Buffer.from(KEY_UTF8, 'utf8');
const iv = Buffer.from(IV_UTF8, 'utf8');

// AES-256 needs 32-byte key; pad if needed
const keyPadded = key.length >= 32 ? key.slice(0, 32) : Buffer.concat([key, Buffer.alloc(32 - key.length, 0)]);

/**
 * Decrypt a message. Returns original text if not encrypted or decryption fails.
 * @param {string} encryptedBase64 - Base64-encoded encrypted text
 * @returns {string}
 */
function decryptChatMessage(encryptedBase64) {
    if (!encryptedBase64 || typeof encryptedBase64 !== 'string') return '';
    const trimmed = encryptedBase64.trim();
    if (!trimmed) return trimmed;

    try {
        const encrypted = Buffer.from(trimmed, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-cbc', keyPadded, iv);
        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        return trimmed;
    }
}

module.exports = { decryptChatMessage };
