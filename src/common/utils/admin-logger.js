const SystemLog = require('../../modules/admin/systemLog.model');
const logger = require('../../config/logger');

/**
 * Log an administrative action to the system audit trail
 * @param {string} adminId - ID of the admin performing the action
 * @param {string} action - Action name (e.g. 'verify_user', 'broadcast')
 * @param {string} targetId - ID of the entity being acted upon
 * @param {string} targetType - Type of the entity ('user', 'job', 'payment')
 * @param {string} description - Human-readable description
 * @param {string} [ip] - IP address of the requester
 */
const logAdminAction = async (adminId, action, targetId, targetType, description, ip = null) => {
  try {
    await SystemLog.create({
      adminId,
      action,
      targetId,
      targetType,
      description,
      ipAddress: ip
    });
  } catch (err) {
    logger.error('Failed to log admin action', err);
  }
};

module.exports = { logAdminAction };
