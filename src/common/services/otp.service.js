const crypto = require('crypto');
const config = require('../../config/env');
const logger = require('../../config/logger');
const Otp = require('../../modules/auth/otp.model');

/**
 * Generate a 6-digit OTP
 */
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Store OTP with expiration (Mongo-backed)
 * @param {String} email - User email
 * @param {String} otp - OTP code
 * @param {String} purpose - Purpose of OTP (login, reset, registration, etc.)
 */
const storeOTP = async (email, otp, purpose = 'login') => {
  const expiresAt = new Date(Date.now() + Number(config.OTP_EXPIRE));

  await Otp.findOneAndUpdate(
    { email, purpose },
    { otp, expiresAt, attempts: 0 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.debug(`OTP stored for ${email} (${purpose})`);
};

/**
 * Verify OTP (Mongo-backed)
 * @param {String} email - User email
 * @param {String} otp - OTP to verify
 * @param {String} purpose - Purpose of OTP
 * @returns {Promise<Boolean>} True if valid, false otherwise
 */
const verifyOTP = async (email, otp, purpose = 'login', deleteOnSuccess = true) => {
  const record = await Otp.findOne({ email, purpose });

  if (!record) {
    logger.debug(`No OTP found for ${email} (${purpose})`);
    return false;
  }

  // Check expiry
  if (record.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: record._id });
    logger.debug(`OTP expired for ${email} (${purpose})`);
    return false;
  }

  // Check attempts (max 5 attempts)
  if (record.attempts >= 5) {
    await Otp.deleteOne({ _id: record._id });
    logger.debug(`Max attempts reached for ${email} (${purpose})`);
    return false;
  }

  // Increment attempts for mismatches
  if (record.otp !== otp) {
    record.attempts += 1;
    await record.save();
    logger.debug(`Invalid OTP for ${email} (${purpose})`);
    return false;
  }

  // OTP verified successfully
  if (deleteOnSuccess) {
    await Otp.deleteOne({ _id: record._id });
  }

  logger.debug(`OTP verified for ${email} (${purpose})`);
  return true;
};

/**
 * Delete OTP (for cleanup)
 */
const deleteOTP = async (email, purpose = 'login') => {
  await Otp.deleteOne({ email, purpose });
};

module.exports = {
  generateOTP,
  storeOTP,
  verifyOTP,
  deleteOTP
};

