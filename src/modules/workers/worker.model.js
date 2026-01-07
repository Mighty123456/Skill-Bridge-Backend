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
    // Replaces simple 'experience'
    experience: {
      type: Number,
      min: 0,
      default: 0
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
    primarySkill: { type: String, trim: true },
    experience: { type: Number, min: 0 },
    city: { type: String, trim: true },

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
  },
  {
    timestamps: true,
  },
);

workerSchema.index({ verificationStatus: 1, createdAt: -1 });

const Worker = mongoose.model('Worker', workerSchema);

module.exports = Worker;


