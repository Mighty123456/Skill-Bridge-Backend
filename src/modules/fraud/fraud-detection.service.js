const FraudAlert = require('./fraud-alert.model');
const User = require('../users/user.model');
const Payment = require('../payments/payment.model');
const Job = require('../jobs/job.model');
const logger = require('../../config/logger');

class FraudDetectionService {
  /**
   * Detect multiple failed payment attempts
   */
  async detectPaymentFailures(userId) {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const failedPayments = await Payment.countDocuments({
        user: userId,
        status: 'failed',
        createdAt: { $gte: oneHourAgo }
      });

      if (failedPayments >= 5) {
        await this.createAlert({
          type: 'payment_failure_spike',
          severity: 'high',
          userId,
          title: 'Multiple Failed Payment Attempts',
          description: `User attempted ${failedPayments} failed payments in the last hour`,
          metadata: {
            failedPaymentCount: failedPayments,
            timeWindow: '1 hour',
            detectionSource: 'payment_service'
          }
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Fraud detection error (payment failures): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect duplicate accounts (same phone/email)
   */
  async detectDuplicateAccounts(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) return false;

      const duplicatePhone = await User.countDocuments({
        phone: user.phone,
        _id: { $ne: userId }
      });

      const duplicateEmail = await User.countDocuments({
        email: user.email,
        _id: { $ne: userId }
      });

      if (duplicatePhone >= 2 || duplicateEmail >= 2) {
        await this.createAlert({
          type: 'multiple_accounts',
          severity: duplicatePhone >= 3 || duplicateEmail >= 3 ? 'high' : 'medium',
          userId,
          title: 'Duplicate Account Detection',
          description: `Same ${duplicatePhone > 0 ? 'phone number' : 'email'} used for ${duplicatePhone + duplicateEmail + 1} different accounts`,
          metadata: {
            duplicatePhoneCount: duplicatePhone,
            duplicateEmailCount: duplicateEmail,
            detectionSource: 'user_service'
          }
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Fraud detection error (duplicate accounts): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect suspicious pricing patterns
   */
  async detectSuspiciousPricing(quotationId, jobId, workerId, totalCost) {
    try {
      // This would be called from quotation service
      // Check if price is suspiciously low or high
      const job = await Job.findById(jobId);
      if (!job) return false;

      // Get market average for this skill
      // OPTIMIZATION: Match status BEFORE lookup to reduce join overhead
      const marketStats = await require('../quotations/quotation.model').aggregate([
        { $match: { status: 'accepted' } },
        {
          $lookup: {
            from: 'jobs',
            localField: 'job_id',
            foreignField: '_id',
            as: 'job'
          }
        },
        { $unwind: '$job' },
        { $match: { 'job.skill_required': job.skill_required } },
        { $group: { _id: null, avg: { $avg: '$total_cost' }, count: { $sum: 1 } } }
      ]);

      if (marketStats.length > 0 && marketStats[0].count >= 3) {
        const marketAvg = marketStats[0].avg;
        const user = await User.findById(workerId);

        if (totalCost < (marketAvg * 0.3)) {
          await this.createAlert({
            type: 'suspicious_pricing',
            severity: 'high',
            userId: workerId,
            jobId,
            title: 'Extremely Low Pricing Detected',
            description: `Quotation is ${((1 - totalCost / marketAvg) * 100).toFixed(0)}% below market average`,
            metadata: {
              quotationId,
              quotedAmount: totalCost,
              marketAverage: marketAvg,
              deviation: ((totalCost / marketAvg - 1) * 100).toFixed(2),
              detectionSource: 'quotation_service'
            }
          });
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error(`Fraud detection error (suspicious pricing): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect profanity violations (called from chat service)
   */
  async detectProfanityViolation(userId, message, violationCount) {
    try {
      if (violationCount >= 3) {
        await this.createAlert({
          type: 'profanity_violation',
          severity: 'medium',
          userId,
          title: 'Repeated Profanity Violations',
          description: `User has ${violationCount} profanity violations and has been muted`,
          metadata: {
            violationCount,
            lastMessage: message?.substring(0, 100),
            detectionSource: 'chat_service'
          }
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Fraud detection error (profanity): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect contact sharing attempts (called from chat service)
   */
  async detectContactSharing(userId, jobId) {
    try {
      // Check if user has multiple contact sharing attempts
      const recentAlerts = await FraudAlert.countDocuments({
        userId,
        type: 'contact_sharing',
        detectedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      if (recentAlerts >= 3) {
        await this.createAlert({
          type: 'contact_sharing',
          severity: 'high',
          userId,
          jobId,
          title: 'Repeated Contact Sharing Attempts',
          description: `User attempted to share contact details ${recentAlerts + 1} times in 24 hours`,
          metadata: {
            attemptCount: recentAlerts + 1,
            detectionSource: 'chat_service'
          }
        });
        return true;
      } else {
        // Create alert for single attempt
        await this.createAlert({
          type: 'contact_sharing',
          severity: 'low',
          userId,
          jobId,
          title: 'Contact Sharing Attempt Blocked',
          description: 'User attempted to share contact details (phone/email/UPI)',
          metadata: {
            attemptCount: 1,
            detectionSource: 'chat_service'
          }
        });
        return false;
      }
    } catch (error) {
      logger.error(`Fraud detection error (contact sharing): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect unusual activity patterns
   */
  async detectUnusualActivity(userId) {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Check for multiple jobs cancelled in short time
      const cancelledJobs = await Job.countDocuments({
        user_id: userId,
        status: 'cancelled',
        updated_at: { $gte: oneDayAgo }
      });

      if (cancelledJobs >= 5) {
        await this.createAlert({
          type: 'unusual_activity',
          severity: 'medium',
          userId,
          title: 'Unusual Cancellation Pattern',
          description: `User cancelled ${cancelledJobs} jobs in the last 24 hours`,
          metadata: {
            cancelledJobCount: cancelledJobs,
            timeWindow: '24 hours',
            detectionSource: 'job_service'
          }
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Fraud detection error (unusual activity): ${error.message}`);
      return false;
    }
  }

  /**
   * Detect IP anomalies (multiple accounts on same IP)
   */
  async detectIPAnomaly(userId, ipAddress) {
    try {
      if (!ipAddress) return false;

      // Check how many different verified users share this IP
      const usersOnIP = await User.countDocuments({
        'legal.ipAddress': ipAddress,
        _id: { $ne: userId },
        status: 'active'
      });

      if (usersOnIP >= 5) {
        await this.createAlert({
          type: 'ip_anomaly',
          severity: usersOnIP >= 10 ? 'high' : 'medium',
          userId,
          title: 'Mass IP Association Detected',
          description: `${usersOnIP} other active accounts are using the same IP address (${ipAddress})`,
          metadata: {
            ipAddress,
            associatedUserCount: usersOnIP,
            detectionSource: 'auth_service'
          }
        });
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Fraud detection error (IP anomaly): ${error.message}`);
      return false;
    }
  }

  /**
   * Create a fraud alert
   */
  async createAlert(alertData) {
    try {
      if (!alertData.userId) {
          logger.warn(`Fraud Alert being created without userId for type: ${alertData.type}. Investigating missing context.`);
      }
      // Check if similar alert already exists (prevent duplicates)
      const existingAlert = await FraudAlert.findOne({
        userId: alertData.userId,
        type: alertData.type,
        status: { $in: ['open', 'investigating'] },
        detectedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Within last hour
      });

      if (existingAlert) {
        // Update existing alert instead of creating duplicate
        const escalatedToHigh = (alertData.severity === 'high' && existingAlert.severity !== 'high');
        
        if (escalatedToHigh || alertData.severity === 'medium' && existingAlert.severity === 'low') {
            existingAlert.severity = alertData.severity;
            existingAlert.title = alertData.title;
            existingAlert.description = alertData.description;
        }

        existingAlert.metadata = { ...existingAlert.metadata, ...alertData.metadata };
        await existingAlert.save();
        
        if (escalatedToHigh) {
            logger.warn(`Fraud alert ESCALATED: ${existingAlert.type} for user ${alertData.userId} (Severity: high)`);
            await this.handleAutoBan(alertData.userId, existingAlert);
        }
        
        return existingAlert;
      }

      const alert = await FraudAlert.create(alertData);
      logger.warn(`Fraud alert created: ${alert.type} for user ${alertData.userId} (Severity: ${alert.severity})`);
      
      // Auto-Ban Logic for High Severity Alerts
      if (alert.severity === 'high') {
        await this.handleAutoBan(alertData.userId, alert);
      }
      
      return alert;
    } catch (error) {
      logger.error(`Error creating fraud alert: ${error.message}`);
      throw error;
    }
  }

  /**
   * Automatically suspend a user for high-risk activity
   */
  async handleAutoBan(userId, alert) {
    try {
      const user = await User.findById(userId);
      if (!user || user.status === 'suspended') return;

      user.status = 'suspended';
      await user.save();

      logger.error(`🚨 AUTO-BAN: User ${userId} suspended due to high-severity ${alert.type} alert.`);
      
      // We could also notify the user here via email, or just log it for admin review
    } catch (err) {
      logger.error(`Auto-ban failed for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Get fraud alerts with filters
   */
  async getAlerts(filters = {}) {
    try {
      const query = {};

      if (filters.status) query.status = filters.status;
      if (filters.severity) query.severity = filters.severity;
      if (filters.type) query.type = filters.type;
      if (filters.userId) query.userId = filters.userId;

      const alerts = await FraudAlert.find(query)
        .populate('userId', 'name email phone role')
        .populate('jobId', 'job_title')
        .populate('resolvedBy', 'name email')
        .sort({ detectedAt: -1 })
        .limit(filters.limit || 100);

      return alerts;
    } catch (error) {
      logger.error(`Error fetching fraud alerts: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resolve a fraud alert
   */
  async resolveAlert(alertId, adminId, resolution, notes) {
    try {
      const alert = await FraudAlert.findById(alertId);
      if (!alert) {
        throw new Error('Fraud alert not found');
      }

      alert.status = resolution === 'false_positive' ? 'false_positive' : 'resolved';
      alert.resolvedAt = new Date();
      alert.resolvedBy = adminId;
      alert.resolutionNotes = notes;

      await alert.save();
      logger.info(`Fraud alert ${alertId} resolved by admin ${adminId} with status: ${resolution}`);

      return alert;
    } catch (error) {
      logger.error(`Error resolving fraud alert: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new FraudDetectionService();
