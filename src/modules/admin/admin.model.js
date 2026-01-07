const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Admin model
 *
 * Stores admin-specific profile/metadata separate from the generic User record.
 * Normalized structure:
 *  - User (auth + core identity)
 *  - Admin (admin-only fields, permissions, org/unit metadata)
 */

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: true,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      default: 'admin',
      immutable: true, // Admin role should not change
    },
    // Admin specific fields
    roleTitle: {
      type: String,
      trim: true,
      default: 'Administrator',
    },
    department: {
      type: String,
      trim: true,
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    lastLogin: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
adminSchema.pre('save', function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  bcrypt.hash(this.password, 12)
    .then((hash) => {
      this.password = hash;
      next();
    })
    .catch((err) => next(err));
});

// Method to compare password
adminSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
