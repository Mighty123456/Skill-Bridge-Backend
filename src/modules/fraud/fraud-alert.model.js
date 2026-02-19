const mongoose = require('mongoose');

const fraudAlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'suspicious_payment',
        'multiple_accounts',
        'unusual_activity',
        'chargeback',
        'fake_review',
        'profanity_violation',
        'contact_sharing',
        'suspicious_pricing',
        'payment_failure_spike',
        'account_takeover',
        'identity_verification_failure'
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['high', 'medium', 'low'],
      required: true,
      default: 'medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'investigating', 'resolved', 'false_positive', 'escalated'],
      default: 'open',
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      // Stores additional context like:
      // - failedPaymentCount
      // - duplicateAccounts
      // - suspiciousPatterns
      // - detectionSource
    },
    detectedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    resolutionNotes: {
      type: String,
    },
    autoDetected: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
fraudAlertSchema.index({ userId: 1, status: 1 });
fraudAlertSchema.index({ type: 1, severity: 1, status: 1 });
fraudAlertSchema.index({ detectedAt: -1 });

const FraudAlert = mongoose.model('FraudAlert', fraudAlertSchema);

module.exports = FraudAlert;
