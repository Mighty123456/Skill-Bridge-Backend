const dns = require('dns').promises;

/**
 * List of common disposable/fake email domains to prevent spam registration.
 */
const DISPOSABLE_DOMAINS = [
  'temp-mail.org', 'tempmail.com', 'guerrillamail.com', 'mailinator.com',
  '10minutemail.com', 'dispostable.com', 'getairmail.com', 'yopmail.com',
  'sharklasers.com', 'trashmail.com', 'dropmail.me', 'maildrop.cc',
  'mintemail.com', 'jetable.org', 'fakeinbox.com', 'teleworm.us',
  'dayrep.com', 'armyspy.com', 'disposable.com', 'trashcanmail.com'
];

/**
 * Validates if an email is from a disposable/fake provider AND has valid mail servers.
 * @param {string} email 
 * @returns {Promise<boolean>} True if email is likely real, false otherwise.
 */
const isRealEmailProvider = async (email) => {
  if (!email || !email.includes('@')) return false;
  
  const domain = email.split('@')[1].toLowerCase();
  
  // 1. Check against the localized blacklist for instant rejection
  if (DISPOSABLE_DOMAINS.includes(domain)) {
    return false;
  }
  
  // 2. Prevent very short/procedural domains
  if (domain.length < 4 || (domain.split('.').length < 2)) {
    return false;
  }

  // 3. DNS Verification: Check if the domain has valid MX (Mail) records
  // This is the most effective way to catch "fake" domains not in the list.
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
  DISPOSABLE_DOMAINS
};
