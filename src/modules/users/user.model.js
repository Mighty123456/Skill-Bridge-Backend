const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../../common/constants/roles');

const userSchema = new mongoose.Schema(
  {
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
      required: function () {
        // Password required only if not using OTP-only login
        return this.loginMethod !== 'otp-only';
      },
      minlength: [6, 'Password must be at least 6 characters'],
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: [ROLES.WORKER, ROLES.USER, ROLES.CONTRACTOR, ROLES.ADMIN],
      required: [true, 'Role is required'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required'],
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      coordinates: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
    },
    // Worker/Contractor specific fields
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
    },
    // Profile image
    profileImage: {
      type: String,
    },
    // Verification documents
    governmentId: {
      type: String,
    },
    selfie: {
      type: String,
    },
    // Account status
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    // Login method preference
    loginMethod: {
      type: String,
      enum: ['password', 'otp', 'both'],
      default: 'both',
    },
    // Last login
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Index for faster queries
userSchema.index({ role: 1 });
userSchema.index({ 'address.coordinates.latitude': 1, 'address.coordinates.longitude': 1 });

// Hash password before saving
userSchema.pre('save', async function () {
  // Only hash password if it's modified
  if (!this.isModified('password')) {
    return;
  }

  // Hash password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get user data without sensitive info
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

const User = mongoose.model('User', userSchema);

module.exports = User;

