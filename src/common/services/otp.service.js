const crypto = require('crypto');
const config = require('../../config/env');
const logger = require('../../config/logger');

// In-memory OTP storage (use Redis in production)
const otpStore = new Map();

/**
 * Generate a 6-digit OTP
 */
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Store OTP with expiration
 * @param {String} email - User email
 * @param {String} otp - OTP code
 * @param {String} purpose - Purpose of OTP (login, reset, etc.)
 */
const storeOTP = (email, otp, purpose = 'login') => {
  const key = `${email}:${purpose}`;
  const expiresAt = Date.now() + config.OTP_EXPIRE;

  otpStore.set(key, {
    otp,
    expiresAt,
    attempts: 0
  });

  // Clean up expired OTPs periodically
  setTimeout(() => {
    otpStore.delete(key);
  }, config.OTP_EXPIRE);

  logger.debug(`OTP stored for ${email} (${purpose})`);
};

/**
 * Verify OTP
 * @param {String} email - User email
 * @param {String} otp - OTP to verify
 * @param {String} purpose - Purpose of OTP
 * @returns {Boolean} True if valid, false otherwise
 */
const verifyOTP = (email, otp, purpose = 'login') => {
  const key = `${email}:${purpose}`;
  const stored = otpStore.get(key);

  if (!stored) {
    logger.debug(`No OTP found for ${email} (${purpose})`);
    return false;
  }

  // Check if expired
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(key);
    logger.debug(`OTP expired for ${email} (${purpose})`);
    return false;
  }

  // Check attempts (max 5 attempts)
  if (stored.attempts >= 5) {
    otpStore.delete(key);
    logger.debug(`Max attempts reached for ${email} (${purpose})`);
    return false;
  }

  // Increment attempts
  stored.attempts += 1;

  // Verify OTP
  if (stored.otp !== otp) {
    logger.debug(`Invalid OTP for ${email} (${purpose})`);
    return false;
  }

  // OTP verified successfully, delete it
  otpStore.delete(key);
  logger.debug(`OTP verified for ${email} (${purpose})`);
  return true;
};

/**
 * Delete OTP (for cleanup)
 */
const deleteOTP = (email, purpose = 'login') => {
  const key = `${email}:${purpose}`;
  otpStore.delete(key);
};

module.exports = {
  generateOTP,
  storeOTP,
  verifyOTP,
  deleteOTP
};

