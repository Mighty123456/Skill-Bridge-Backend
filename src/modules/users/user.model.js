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
    // GeoJSON for efficient geospatial querying
    location: {
      type: {
        type: String,
        enum: ['Point'],
        // default: 'Point', // REMOVED: prevents creating invalid objects with just type but no coordinates
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    // Profile image
    profileImage: {
      type: String,
    },
    // Account status
    isActive: {
      type: Boolean,
      default: true,
    },
    // Legacy boolean flag for worker verification (kept for backwards compatibility)
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
    // Worker Availability Status
    isOnline: {
      type: Boolean,
      default: false,
    },
    // Last login
    lastLogin: {
      type: Date,
    },
    // Device Binding
    currentSessionId: {
      type: String,
      select: false // Do not return by default
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Indexes
userSchema.index({ role: 1 });
userSchema.index({ location: '2dsphere' }); // GEOSPATIAL INDEX

// Hash password before saving & Sync Location
userSchema.pre('save', function (next) {
  // Sync legacy address.coordinates to GeoJSON location
  // Check specifically for null/undefined to allow 0.0 coordinates
  if (this.address && this.address.coordinates &&
    this.address.coordinates.latitude != null &&
    this.address.coordinates.longitude != null) {
    this.location = {
      type: 'Point',
      coordinates: [this.address.coordinates.longitude, this.address.coordinates.latitude]
    };
  } else {
    // If coordinates are missing, ensure location is undefined to avoid validation errors
    if (!this.location || !this.location.coordinates || this.location.coordinates.length === 0) {
      this.location = undefined;
    }
  }

  // Only hash password if it's modified
  if (!this.isModified('password')) {
    return next();
  }

  // Hash password with cost of 12
  bcrypt.hash(this.password, 12)
    .then((hash) => {
      this.password = hash;
      next();
    })
    .catch((err) => next(err));
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

