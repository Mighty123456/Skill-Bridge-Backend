const mongoose = require('mongoose');

/**
 * Badge model
 * 
 * Represents recognition/verification badges that can be assigned to workers,
 * e.g. "KYC Verified", "Top Rated", "Background Checked".
 */

const badgeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      default: '#4f46e5', // Indigo as default accent
    },
    icon: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

const Badge = mongoose.model('Badge', badgeSchema);

module.exports = Badge;


