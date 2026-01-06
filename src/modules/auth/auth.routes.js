const express = require('express');
const { validationResult } = require('express-validator');
const authController = require('./auth.controller');
const authSchema = require('./auth.schema');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { uploadSingle, handleUploadError } = require('../../common/middleware/upload.middleware');

const router = express.Router();

/**
 * Validation middleware
 */
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  };
};

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user (Worker, User, or Contractor)
 * @access  Public
 */
router.post('/register', validate(authSchema.registerSchema), authController.register);

/**
 * @route   POST /api/auth/login
 * @desc    Login with email and password
 * @access  Public
 */
router.post('/login', validate(authSchema.loginSchema), authController.login);

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP for login
 * @access  Public
 */
router.post('/send-otp', validate(authSchema.sendOTPSchema), authController.sendLoginOTP);

/**
 * @route   POST /api/auth/login-otp
 * @desc    Login with OTP
 * @access  Public
 */
router.post('/login-otp', validate(authSchema.loginOTPSchema), authController.loginWithOTP);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send OTP for password reset
 * @access  Public
 */
router.post('/forgot-password', validate(authSchema.sendOTPSchema), authController.sendPasswordResetOTP);

/**
 * @route   POST /api/auth/verify-reset-otp
 * @desc    Verify OTP for password reset
 * @access  Public
 */
router.post('/verify-reset-otp', validate(authSchema.loginOTPSchema), authController.verifyPasswordResetOTP);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with OTP
 * @access  Public
 */
router.post('/reset-password', validate(authSchema.resetPasswordSchema), authController.resetPassword);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticate, authController.getProfile);

/**
 * @route   POST /api/auth/upload-profile-image
 * @desc    Upload profile image
 * @access  Private
 */
router.post(
  '/upload-profile-image',
  authenticate,
  uploadSingle('image'),
  handleUploadError,
  authController.uploadProfileImage
);

/**
 * @route   DELETE /api/auth/delete-profile-image
 * @desc    Delete profile image
 * @access  Private
 */
router.delete('/delete-profile-image', authenticate, authController.deleteProfileImage);

module.exports = router;

