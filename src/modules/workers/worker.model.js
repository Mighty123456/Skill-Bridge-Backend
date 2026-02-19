const mongoose = require('mongoose');

/**
 * Worker model
 * 
 * This collection stores worker-specific data and verification state,
 * while core auth/profile fields live on the User model.
 */

const workerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // Professional Info
    services: [{
      type: String,
      trim: true,
    }],
    skills: [{
      type: String,
      trim: true,
    }],
    experience: {
      type: Number,
      min: 0,
      default: 0
    },
    totalJobsCompleted: {
      type: Number,
      default: 0,
      index: true
    },

    // Rating
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 5.0
    },

    // Hourly Rate (e.g. 100)
    hourlyRate: {
      type: Number,
      min: 0,
      default: 0
    },

    // Warranty Offered (Days) - For filtering
    warranty_days: {
      type: Number,
      default: 0, // 0 means no warranty
      index: true
    },

    // Trust Score (0-100)
    reliabilityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50, // Initial Score
      index: true
    },

    // Reliability detailed stats
    reliabilityStats: {
      punctuality: { type: Number, default: 0 }, // Positive or negative
      disputes: { type: Number, default: 0 }, // Count of disputes involved in
      cancellations: { type: Number, default: 0 }, // Count of cancellations initiated
    },

    // Verification Documents (URLs)
    governmentId: {
      type: String,
    },
    selfie: {
      type: String,
    },

    // Verification status lifecycle
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },

    // Cached display fields for admin list views (denormalized from User)
    city: { type: String, trim: true },
    state: { type: String, trim: true },

    // Documents stored in a separate collection
    documents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WorkerDocument',
      },
    ],

    // Badges assigned to worker
    badges: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Badge',
      },
    ],

    // Skill Decay Tracking
    skill_stats: [
      {
        skill: { type: String, required: true },
        confidence: { type: Number, default: 100, min: 0, max: 100 },
        last_used: { type: Date, default: Date.now },
        decay_warning_sent: { type: Boolean, default: false },
      }
    ],

    // Warranty Recalls (Passport)
    warranty_recalls: [
      {
        job_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
        reason: { type: String, trim: true },
        date: { type: Date, default: Date.now },
        resolved: { type: Boolean, default: false },
      }
    ],

    // Micro-zone Trust Ranking
    reputation_zones: [
      {
        zone_name: { type: String, trim: true }, // e.g., "Downtown", "Andheri West"
        score: { type: Number, default: 0 },
        jobs_completed: { type: Number, default: 0 },
      }
    ],

    // Audit trail for verification status changes
    statusHistory: [
      {
        status: {
          type: String,
          enum: ['pending', 'verified', 'rejected'],
          required: true,
        },
        reason: { type: String, trim: true },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
      },
    ],

    // Subscription
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'gold', 'platinum'],
        default: 'free'
      },
      expiry: Date,
      autoRenew: { type: Boolean, default: false }
    },

    // Financial (Stripe Connect)
    stripeAccountId: { type: String, trim: true },
    stripeOnboarded: { type: Boolean, default: false },

  },
  {
    timestamps: true,
  },
);

workerSchema.index({ 'reputation_zones.score': -1 });
workerSchema.index({ verificationStatus: 1, createdAt: -1 });

const Worker = mongoose.model('Worker', workerSchema);

module.exports = Worker;


