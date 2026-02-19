const fraudDetectionService = require('./fraud-detection.service');
const { successResponse, errorResponse } = require('../../common/utils/response');
const logger = require('../../config/logger');

/**
 * Get all fraud alerts with optional filters
 * GET /api/admin/fraud-alerts?status=open&severity=high&type=suspicious_payment
 */
const getFraudAlerts = async (req, res) => {
  try {
    const { status, severity, type, userId, limit } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (severity) filters.severity = severity;
    if (type) filters.type = type;
    if (userId) filters.userId = userId;
    if (limit) filters.limit = parseInt(limit);

    const alerts = await fraudDetectionService.getAlerts(filters);

    // Get summary stats
    const stats = {
      total: alerts.length,
      open: alerts.filter(a => a.status === 'open').length,
      investigating: alerts.filter(a => a.status === 'investigating').length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
      low: alerts.filter(a => a.severity === 'low').length,
    };

    return successResponse(res, 'Fraud alerts fetched successfully', {
      alerts,
      stats
    });
  } catch (error) {
    logger.error(`Admin getFraudAlerts error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch fraud alerts', 500);
  }
};

/**
 * Get a single fraud alert
 * GET /api/admin/fraud-alerts/:id
 */
const getFraudAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const FraudAlert = require('./fraud-alert.model');

    const alert = await FraudAlert.findById(id)
      .populate('userId', 'name email phone role address')
      .populate('jobId', 'job_title status')
      .populate('paymentId')
      .populate('resolvedBy', 'name email');

    if (!alert) {
      return errorResponse(res, 'Fraud alert not found', 404);
    }

    return successResponse(res, 'Fraud alert fetched successfully', { alert });
  } catch (error) {
    logger.error(`Admin getFraudAlert error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch fraud alert', 500);
  }
};

/**
 * Resolve a fraud alert
 * POST /api/admin/fraud-alerts/:id/resolve
 */
const resolveFraudAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution, notes } = req.body;

    if (!resolution || !['resolved', 'false_positive', 'escalated'].includes(resolution)) {
      return errorResponse(res, 'Invalid resolution status', 400);
    }

    const alert = await fraudDetectionService.resolveAlert(
      id,
      req.user._id,
      resolution,
      notes
    );

    return successResponse(res, 'Fraud alert resolved successfully', { alert });
  } catch (error) {
    logger.error(`Admin resolveFraudAlert error: ${error.message}`);
    return errorResponse(res, error.message || 'Failed to resolve fraud alert', 500);
  }
};

/**
 * Mark alert as investigating
 * POST /api/admin/fraud-alerts/:id/investigate
 */
const investigateFraudAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const FraudAlert = require('./fraud-alert.model');

    const alert = await FraudAlert.findById(id);
    if (!alert) {
      return errorResponse(res, 'Fraud alert not found', 404);
    }

    alert.status = 'investigating';
    await alert.save();

    return successResponse(res, 'Fraud alert marked as investigating', { alert });
  } catch (error) {
    logger.error(`Admin investigateFraudAlert error: ${error.message}`);
    return errorResponse(res, 'Failed to update fraud alert', 500);
  }
};

/**
 * Get fraud statistics
 * GET /api/admin/fraud-alerts/stats
 */
const getFraudStats = async (req, res) => {
  try {
    const FraudAlert = require('./fraud-alert.model');

    const [
      totalAlerts,
      openAlerts,
      highSeverity,
      alertsByType,
      recentAlerts
    ] = await Promise.all([
      FraudAlert.countDocuments(),
      FraudAlert.countDocuments({ status: 'open' }),
      FraudAlert.countDocuments({ severity: 'high', status: { $in: ['open', 'investigating'] } }),
      FraudAlert.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      FraudAlert.countDocuments({
        detectedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      })
    ]);

    return successResponse(res, 'Fraud statistics fetched successfully', {
      total: totalAlerts,
      open: openAlerts,
      highSeverity,
      recent: recentAlerts,
      byType: alertsByType
    });
  } catch (error) {
    logger.error(`Admin getFraudStats error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch fraud statistics', 500);
  }
};

module.exports = {
  getFraudAlerts,
  getFraudAlert,
  resolveFraudAlert,
  investigateFraudAlert,
  getFraudStats
};
