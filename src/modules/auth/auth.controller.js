const authService = require('./auth.service');
const { successResponse, errorResponse } = require('../../common/utils/response');
const logger = require('../../config/logger');

/**
 * Register a new user
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const result = await authService.register(req.body);
    return successResponse(res, 'Registration successful', result, 201);
  } catch (error) {
    logger.error(`Registration error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Login with email and password
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    return successResponse(res, 'Login successful', result);
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    return errorResponse(res, error.message, 401);
  }
};

/**
 * Send OTP for login
 * POST /api/auth/send-otp
 */
const sendLoginOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.sendLoginOTP(email);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Send OTP error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Login with OTP
 * POST /api/auth/login-otp
 */
const loginWithOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.loginWithOTP(email, otp);
    return successResponse(res, 'Login successful', result);
  } catch (error) {
    logger.error(`OTP login error: ${error.message}`);
    return errorResponse(res, error.message, 401);
  }
};

/**
 * Send OTP for password reset
 * POST /api/auth/forgot-password
 */
const sendPasswordResetOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.sendPasswordResetOTP(email);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Password reset OTP error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Verify OTP for password reset
 * POST /api/auth/verify-reset-otp
 */
const verifyPasswordResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyPasswordResetOTP(email, otp);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Verify reset OTP error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Reset password
 * POST /api/auth/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await authService.resetPassword(email, otp, newPassword);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Reset password error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Get current user profile
 * GET /api/auth/profile
 */
const getProfile = async (req, res) => {
  try {
    const user = await authService.getProfile(req.userId);
    return successResponse(res, 'Profile retrieved successfully', { user });
  } catch (error) {
    logger.error(`Get profile error: ${error.message}`);
    return errorResponse(res, error.message, 404);
  }
};

/**
 * Upload profile image
 * POST /api/auth/upload-profile-image
 */
const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'No image file provided', 400);
    }

    const result = await authService.uploadProfileImage(req.userId, req.file.buffer);

    // Add Render URL info for file uploads
    const { getUploadURL } = require('../../common/utils/backend-urls');
    result.uploadService = getUploadURL('');

    return successResponse(res, 'Profile image uploaded successfully', result);
  } catch (error) {
    logger.error(`Upload profile image error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Delete profile image
 * DELETE /api/auth/delete-profile-image
 */
const deleteProfileImage = async (req, res) => {
  try {
    const result = await authService.deleteProfileImage(req.userId);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Delete profile image error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Verify registration OTP
 * POST /api/auth/verify-registration
 */
const verifyRegistration = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyRegistration(email, otp);
    return successResponse(res, result.message, result);
  } catch (error) {
    logger.error(`Verify registration error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Resend OTP
 * POST /api/auth/resend-otp
 */
const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.resendOTP(email);
    return successResponse(res, result.message);
  } catch (error) {
    logger.error(`Resend OTP error: ${error.message}`);
    return errorResponse(res, error.message, 400);
  }
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
  verifyRegistration,
  resendOTP,
};
