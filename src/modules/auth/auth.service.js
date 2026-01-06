const User = require('../users/user.model');
const { generateToken } = require('../../common/utils/jwt');
const { generateOTP, storeOTP, verifyOTP } = require('../../common/services/otp.service');
const { sendOTPEmail, sendWelcomeEmail } = require('../../common/services/email.service');
const { uploadProfileImage: uploadImageToCloudinary, deleteImage, extractPublicId } = require('../../common/services/cloudinary.service');
const logger = require('../../config/logger');
const { ROLES } = require('../../common/constants/roles');

/**
 * Register a new user
 */
const register = async (userData) => {
  const { email, password, role, name, phone, dateOfBirth, address, services, skills, experience } = userData;

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // Validate role
  if (![ROLES.WORKER, ROLES.USER, ROLES.CONTRACTOR].includes(role)) {
    throw new Error('Invalid role');
  }

  // Create user object
  const userFields = {
    email: email.toLowerCase(),
    password,
    role,
    name,
    phone,
    dateOfBirth,
    address: address || {},
  };

  // Add role-specific fields
  if (role === ROLES.WORKER || role === ROLES.CONTRACTOR) {
    if (services && services.length > 0) {
      userFields.services = services;
    }
    if (skills && skills.length > 0) {
      userFields.skills = skills;
    }
    if (experience !== undefined) {
      userFields.experience = experience;
    }
  }

  // Create user
  const user = await User.create(userFields);

  // Send welcome email (non-blocking)
  sendWelcomeEmail(user.email, user.name).catch(err => {
    logger.error(`Failed to send welcome email: ${err.message}`);
  });

  // Generate token
  const token = generateToken({ userId: user._id, role: user.role });

  // Remove password from response
  const userResponse = user.toJSON();

  logger.info(`New user registered: ${user.email} (${user.role})`);

  return {
    user: userResponse,
    token,
  };
};

/**
 * Login with email and password
 */
const login = async (email, password) => {
  // Find user and include password field
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Check if account is active
  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate token
  const token = generateToken({ userId: user._id, role: user.role });

  // Remove password from response
  const userResponse = user.toJSON();

  logger.info(`User logged in: ${user.email} (${user.role})`);

  return {
    user: userResponse,
    token,
  };
};

/**
 * Send OTP for login
 */
const sendLoginOTP = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new Error('No account found with this email address');
  }

  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  // Generate and store OTP
  const otp = generateOTP();
  storeOTP(email.toLowerCase(), otp, 'login');

  // Send OTP via email
  await sendOTPEmail(email.toLowerCase(), otp, 'login');

  logger.info(`Login OTP sent to: ${email}`);

  return {
    message: 'OTP sent to your email address',
  };
};

/**
 * Login with OTP
 */
const loginWithOTP = async (email, otp) => {
  // Verify OTP
  const isOTPValid = verifyOTP(email.toLowerCase(), otp, 'login');

  if (!isOTPValid) {
    throw new Error('Invalid or expired OTP');
  }

  // Find user
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate token
  const token = generateToken({ userId: user._id, role: user.role });

  // Remove password from response
  const userResponse = user.toJSON();

  logger.info(`User logged in with OTP: ${user.email} (${user.role})`);

  return {
    user: userResponse,
    token,
  };
};

/**
 * Send OTP for password reset
 */
const sendPasswordResetOTP = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    // Don't reveal if email exists for security
    return {
      message: 'If an account exists with this email, an OTP has been sent',
    };
  }

  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  // Generate and store OTP
  const otp = generateOTP();
  storeOTP(email.toLowerCase(), otp, 'reset');

  // Send OTP via email
  await sendOTPEmail(email.toLowerCase(), otp, 'reset');

  logger.info(`Password reset OTP sent to: ${email}`);

  return {
    message: 'If an account exists with this email, an OTP has been sent',
  };
};

/**
 * Verify OTP for password reset
 */
const verifyPasswordResetOTP = async (email, otp) => {
  const isOTPValid = verifyOTP(email.toLowerCase(), otp, 'reset');

  if (!isOTPValid) {
    throw new Error('Invalid or expired OTP');
  }

  return {
    message: 'OTP verified successfully',
  };
};

/**
 * Reset password
 */
const resetPassword = async (email, otp, newPassword) => {
  // Verify OTP first
  const isOTPValid = verifyOTP(email.toLowerCase(), otp, 'reset');

  if (!isOTPValid) {
    throw new Error('Invalid or expired OTP');
  }

  // Find user and include password field
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

  if (!user) {
    throw new Error('User not found');
  }

  // Update password
  user.password = newPassword;
  await user.save();

  logger.info(`Password reset for: ${email}`);

  return {
    message: 'Password reset successfully',
  };
};

/**
 * Get current user profile
 */
const getProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  return user.toJSON();
};

/**
 * Upload profile image
 */
const uploadProfileImage = async (userId, imageBuffer) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Delete old image if exists
  if (user.profileImage) {
    const oldPublicId = extractPublicId(user.profileImage);
    if (oldPublicId) {
      try {
        await deleteImage(oldPublicId);
      } catch (error) {
        logger.warn(`Failed to delete old profile image: ${error.message}`);
      }
    }
  }

  // Upload new image to Cloudinary
  const uploadResult = await uploadImageToCloudinary(imageBuffer, userId);

  // Update user profile image
  user.profileImage = uploadResult.url;
  await user.save({ validateBeforeSave: false });

  logger.info(`Profile image uploaded for user: ${userId}`);

  return {
    profileImage: uploadResult.url,
    message: 'Profile image uploaded successfully',
  };
};

/**
 * Delete profile image
 */
const deleteProfileImage = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  if (!user.profileImage) {
    return { message: 'No profile image to delete' };
  }

  // Extract public ID and delete from Cloudinary
  const publicId = extractPublicId(user.profileImage);
  if (publicId) {
    try {
      await deleteImage(publicId);
    } catch (error) {
      logger.warn(`Failed to delete image from Cloudinary: ${error.message}`);
    }
  }

  // Remove image URL from user
  user.profileImage = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`Profile image deleted for user: ${userId}`);

  return { message: 'Profile image deleted successfully' };
};

module.exports = {
  register,
  login,
  sendLoginOTP,
  loginWithOTP,
  sendPasswordResetOTP,
  verifyPasswordResetOTP,
  resetPassword,
  getProfile,
  uploadProfileImage,
  deleteProfileImage,
};

