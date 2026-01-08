const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const WorkerDocument = require('../workers/document.model');
const Admin = require('../admin/admin.model');
const Contractor = require('../contractors/contractor.model');
const { generateToken } = require('../../common/utils/jwt');
const { generateOTP, storeOTP, verifyOTP } = require('../../common/services/otp.service');
const { sendOTPEmail, sendWelcomeEmail } = require('../../common/services/email.service');
const { uploadProfileImage: uploadImageToCloudinary, deleteImage, extractPublicId } = require('../../common/services/cloudinary.service');
const config = require('../../config/env');
const logger = require('../../config/logger');
const { ROLES } = require('../../common/constants/roles');

/**
 * Register a new user
 */
const register = async (userData, fileBuffers = {}) => {
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

  // 2. Create base User (Auth & Profile)
  const user = await User.create({
    email: email.toLowerCase(),
    password,
    role,
    name,
    phone,
    dateOfBirth,
    address: address || {},
  });

  // 3. Create Role-Specific Profiles

  // --- WORKER ---
  if (role === ROLES.WORKER) {
    const workerData = {
      user: user._id,
      services: services || [],
      skills: skills || [],
      experience: experience || 0,
      verificationStatus: 'pending',
      city: address?.city,
      state: address?.state,
    };

    // Upload Documents
    const documentIds = [];

    if (fileBuffers.governmentId) {
      try {
        const uploadResult = await uploadImageToCloudinary(fileBuffers.governmentId, `id_${email}`);
        workerData.governmentId = uploadResult.url;

        // Create Document Record
        const doc = await WorkerDocument.create({
          worker: user._id, // Will be updated to Worker ID if needed, but schema refs Worker. 
          // Note: Worker ID is separate from User ID.
          // We need the Worker ID first? No, we are creating Worker now.
          // We can create docs after Worker is created or use User ID temporarily?
          // Worker schema says ref: 'Worker'. So we need Worker ID.
          // We will create docs AFTER Worker creation.
        });
        // Wait, saving url to temp var to use later
      } catch (err) {
        logger.error(`Failed to upload government ID: ${err.message}`);
      }
    }
    // REFACTORING LOGIC:
    // Since WorkerDocument requires Worker ID, we must create Worker first, then Documents, then update Worker with Document IDs.

    // 1. Upload images first
    let govIdUrl = null;
    let selfieUrl = null;

    if (fileBuffers.governmentId) {
      try {
        const res = await uploadImageToCloudinary(fileBuffers.governmentId, `id_${email}`);
        govIdUrl = res.url;
        workerData.governmentId = govIdUrl;
      } catch (err) { logger.error(`Gov ID upload failed: ${err.message}`); }
    }
    if (fileBuffers.selfie) {
      try {
        const res = await uploadImageToCloudinary(fileBuffers.selfie, `selfie_${email}`);
        selfieUrl = res.url;
        workerData.selfie = selfieUrl;
      } catch (err) { logger.error(`Selfie upload failed: ${err.message}`); }
    }

    try {
      const newWorker = await Worker.create(workerData);
      const docsToCreate = [];

      if (govIdUrl) {
        docsToCreate.push({
          worker: newWorker._id,
          type: 'governmentId',
          url: govIdUrl,
          label: 'Government ID'
        });
      }
      if (selfieUrl) {
        docsToCreate.push({
          worker: newWorker._id,
          type: 'selfie',
          url: selfieUrl,
          label: 'Selfie'
        });
      }

      if (docsToCreate.length > 0) {
        const createdDocs = await WorkerDocument.insertMany(docsToCreate);
        newWorker.documents = createdDocs.map(d => d._id);
        await newWorker.save();
      }
    } catch (err) {
      logger.error(`Failed to create Worker record: ${err.message}`);
    }
  }

  // --- CONTRACTOR ---
  if (role === ROLES.CONTRACTOR) {
    const contractorData = {
      user: user._id,
      services: services || [],
      experience: experience || 0,
      verificationStatus: 'pending',
      city: address?.city,
      state: address?.state,
    };

    // Upload Documents
    if (fileBuffers.governmentId) {
      try {
        const uploadResult = await uploadImageToCloudinary(fileBuffers.governmentId, `id_${email}`);
        contractorData.governmentId = uploadResult.url;
      } catch (err) {
        logger.error(`Failed to upload government ID: ${err.message}`);
      }
    }
    if (fileBuffers.selfie) {
      try {
        const uploadResult = await uploadImageToCloudinary(fileBuffers.selfie, `selfie_${email}`);
        contractorData.selfie = uploadResult.url;
      } catch (err) {
        logger.error(`Failed to upload selfie: ${err.message}`);
      }
    }

    try {
      await Contractor.create(contractorData);
    } catch (err) {
      logger.error(`Failed to create Contractor record: ${err.message}`);
    }
  }



  // For admins, create a normalized Admin profile
  if (role === ROLES.ADMIN) {
    try {
      await Admin.create({
        user: user._id,
        roleTitle: 'Administrator',
        department: 'Operations',
        permissions: ['all'],
      });
    } catch (err) {
      logger.error(`Failed to create Admin record for ${email}: ${err.message}`);
    }
  }

  // Generate and send OTP for email verification
  const otp = generateOTP();
  await storeOTP(email.toLowerCase(), otp, 'registration');

  // Send OTP via email
  const emailResult = await sendOTPEmail(email.toLowerCase(), otp, 'registration');
  const debugOtp = (!emailResult.success && config.NODE_ENV !== 'production') ? otp : undefined;

  // Send welcome email (non-blocking)
  sendWelcomeEmail(user.email, user.name).catch(err => {
    logger.error(`Failed to send welcome email: ${err.message}`);
  });

  logger.info(`New user registered: ${user.email} (${user.role})`);

  return {
    message: 'Registration successful. Please verify your email with the OTP sent to your email address.',
    email: user.email,
    ...(debugOtp ? { debugOtp } : {}),
  };
};

/**
 * Login with email and password
 */
const login = async (email, password) => {
  logger.info('Login service started');
  // First, try finding in User collection
  let user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  let isUser = true;

  // If not found in User, check Admin collection
  if (!user) {
    user = await Admin.findOne({ email: email.toLowerCase() }).select('+password');
    isUser = false;
  }

  logger.info(user ? `User found (Collection: ${isUser ? 'User' : 'Admin'})` : 'User not found');

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Check if account is active
  if (!user.isActive) {
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  // Verify password
  logger.info('Comparing password');
  const isPasswordValid = await user.comparePassword(password);
  logger.info('Password compared');
  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  // Update last login
  // Note: Admin model has 'lastLogin', User model has 'lastLogin'. 
  // If field names differed, we'd need a check. They seem consistent enough or we can use generic assignment.
  user.lastLogin = new Date();
  logger.info('Saving user');
  try {
    await user.save({ validateBeforeSave: false });
  } catch (e) {
    logger.error('Error saving user: ' + e.message);
    throw e;
  }
  logger.info('User saved');

  // Generate token
  // Ensure 'role' is present on both models. Admin model has default role='admin'.
  const token = generateToken({ userId: user._id, role: user.role });

  // Remove password from response
  const userResponse = user.toObject();
  delete userResponse.password;

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
  await storeOTP(email.toLowerCase(), otp, 'login');

  // Send OTP via email
  const emailResult = await sendOTPEmail(email.toLowerCase(), otp, 'login');
  const debugOtp = (!emailResult.success && config.NODE_ENV !== 'production') ? otp : undefined;

  logger.info(`Login OTP sent to: ${email}`);

  return {
    message: 'OTP sent to your email address',
    ...(debugOtp ? { debugOtp } : {}),
  };
};

/**
 * Login with OTP
 */
const loginWithOTP = async (email, otp) => {
  // Verify OTP
  const isOTPValid = await verifyOTP(email.toLowerCase(), otp, 'login');

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
 * Verify OTP (for login - returns user and token if valid)
 */
const verifyOTPForLogin = async (email, otp) => {
  // Verify OTP using the OTP service
  const isOTPValid = await verifyOTP(email.toLowerCase(), otp, 'login');

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

  logger.info(`OTP verified for: ${user.email} (${user.role})`);

  return {
    user: userResponse,
    token,
    verified: true,
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
  await storeOTP(email.toLowerCase(), otp, 'reset');

  // Send OTP via email
  const emailResult = await sendOTPEmail(email.toLowerCase(), otp, 'reset');
  const debugOtp = (!emailResult.success && config.NODE_ENV !== 'production') ? otp : undefined;

  logger.info(`Password reset OTP sent to: ${email}`);

  return {
    message: 'If an account exists with this email, an OTP has been sent',
    ...(debugOtp ? { debugOtp } : {}),
  };
};

/**
 * Verify OTP for password reset
 */
const verifyPasswordResetOTP = async (email, otp) => {
  const isOTPValid = await verifyOTP(email.toLowerCase(), otp, 'reset', false);

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
  const isOTPValid = await verifyOTP(email.toLowerCase(), otp, 'reset');

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
  let user = await User.findById(userId);
  let extraData = {};

  if (!user) {
    user = await Admin.findById(userId);
  } else {
    // Fetch role specific data
    if (user.role === ROLES.WORKER) {
      const worker = await Worker.findOne({ user: user._id }).populate('documents');
      if (worker) extraData = worker.toObject();
    } else if (user.role === ROLES.CONTRACTOR) {
      const contractor = await Contractor.findOne({ user: user._id });
      if (contractor) extraData = contractor.toObject();
    }
  }

  if (!user) {
    throw new Error('User not found');
  }

  return {
    ...user.toObject(),
    ...extraData,
    _id: user._id, // Ensure primary ID is the user ID
  };
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

  // Return the Render URL for the uploaded image endpoint
  const { getUploadURL } = require('../../common/utils/backend-urls');
  const uploadEndpoint = getUploadURL('/auth/upload-profile-image');

  return {
    profileImage: uploadResult.url,
    uploadEndpoint: uploadEndpoint,
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

/**
 * Verify registration OTP
 */
const verifyRegistration = async (email, otp) => {
  // Verify OTP
  const isOTPValid = await verifyOTP(email.toLowerCase(), otp, 'registration');

  if (!isOTPValid) {
    throw new Error('Invalid or expired OTP');
  }

  // Find user
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new Error('User not found');
  }

  // Mark user as verified
  user.isEmailVerified = true;
  await user.save({ validateBeforeSave: false });

  // Generate token for auto-login
  const token = generateToken({ userId: user._id, role: user.role });

  // Remove password from response
  const userResponse = user.toJSON();

  logger.info(`User verified registration: ${user.email}`);

  return {
    user: userResponse,
    token,
    message: 'Email verified successfully',
  };
};

/**
 * Resend OTP
 */
const resendOTP = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new Error('No account found with this email address');
  }

  // Generate and store OTP
  const otp = generateOTP();
  await storeOTP(email.toLowerCase(), otp, 'registration');

  // Send OTP via email
  const emailResult = await sendOTPEmail(email.toLowerCase(), otp, 'registration');
  const debugOtp = (!emailResult.success && config.NODE_ENV !== 'production') ? otp : undefined;

  logger.info(`Registration OTP resent to: ${email}`);

  return {
    message: 'OTP sent to your email address',
    ...(debugOtp ? { debugOtp } : {}),
  };
};

/**
 * Update user profile
 */
const updateProfile = async (userId, updateData) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  // Fields allowed to be updated
  const allowedUpdates = ['name', 'phone', 'address', 'dateOfBirth'];

  allowedUpdates.forEach((field) => {
    if (updateData[field] !== undefined) {
      if (field === 'address' && typeof updateData[field] === 'object') {
        user.address = { ...user.address, ...updateData[field] };
      } else {
        user[field] = updateData[field];
      }
    }
  });

  await user.save();

  logger.info(`Profile updated for user: ${userId}`);

  return user.toObject();
};

module.exports = {
  register,
  login,
  sendLoginOTP,
  loginWithOTP,
  verifyOTP: verifyOTPForLogin,
  sendPasswordResetOTP,
  verifyPasswordResetOTP,
  resetPassword,
  getProfile,
  updateProfile,
  uploadProfileImage,
  deleteProfileImage,
  verifyRegistration,
  resendOTP,
};

