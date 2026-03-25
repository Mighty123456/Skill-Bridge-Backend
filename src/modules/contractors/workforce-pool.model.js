const mongoose = require('mongoose');

/**
 * Workforce Pool Model
 * Stores preferred/favorite workers for a specific contractor.
 * Phase 8: Workforce Pool
 */
const workforcePoolSchema = new mongoose.Schema(
  {
    contractor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    workerProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      trim: true,
    },
    tags: [{
      type: String,
      trim: true,
    }],
  },
  {
    timestamps: true,
  }
);

// Ensure a worker can be added to a contractor's pool only once
workforcePoolSchema.index({ contractor: 1, worker: 1 }, { unique: true });

const WorkforcePool = mongoose.model('WorkforcePool', workforcePoolSchema);

module.exports = WorkforcePool;
