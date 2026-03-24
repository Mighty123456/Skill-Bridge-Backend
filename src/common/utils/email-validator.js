const dns = require('dns').promises;
const disposableDomains = require('disposable-email-domains');
const emailValidator = require('deep-email-validator');

/**
 * Validates if an email is from a disposable/fake provider AND has valid mail servers.
 * @param {string} email 
 * @returns {Promise<boolean>} True if email is likely real, false otherwise.
 */
const isRealEmailProvider = async (email) => {
  if (!email || !email.includes('@')) return false;
  
  const domain = email.split('@')[1].toLowerCase();
  
  // 1. Check against the localized blacklist for instant rejection
  if (disposableDomains.includes(domain)) {
    return false;
  }
  
  // 2. Prevent very short/procedural domains
  if (domain.length < 4 || (domain.split('.').length < 2)) {
    return false;
  }

  // 3. Deep Email Verification (Checks Regex, Typo, Disposable, MX)
  try {
    const { valid, validators } = await emailValidator.validate({
      email: email,
      validateRegex: true,
      validateMx: true,
      validateTypo: false, // Disable typo check to avoid rejecting slightly mispelled but valid domains
      validateDisposable: true,
      validateSMTP: false // SMTP validation is notoriously slow and unreliable
    });

    // If it's flagged as disposable by the robust checker, reject it
    if (validators.disposable && !validators.disposable.valid) {
      return false;
    }
    
    // If MX records failed, reject
    if (validators.mx && !validators.mx.valid) {
        return false;
    }
  } catch (error) {
    console.error(`Deep email validation error for ${email}:`, error.message);
  }

  // 4. Fallback DNS Verification: Check if the domain has valid MX (Mail) records manually just in case
  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return false; // Domain exists but cannot receive email
    }
    return true;
  } catch (error) {
    // If ENOTFOUND or ENODATA, the domain doesn't exist or is invalid for email
    return false;
  }
};

module.exports = {
  isRealEmailProvider,
  DISPOSABLE_DOMAINS: disposableDomains
};
