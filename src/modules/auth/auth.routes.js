const express = require('express');
const { validationResult } = require('express-validator');
const authController = require('./auth.controller');
const authSchema = require('./auth.schema');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { uploadSingle, uploadFields, catchUploadErrors } = require('../../common/middleware/upload.middleware');

const router = express.Router();

/**
 * Middleware to parse stringified JSON fields
 */
const parseJsonFields = (fields) => {
  return (req, res, next) => {
    fields.forEach(field => {
      if (req.body[field] && typeof req.body[field] === 'string') {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    });

    if (typeof next === 'function') {
      next();
    }
  };
};

/**
 * Validation middleware
 */
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      if (typeof next === 'function') {
        return next();
      }
      return;
    }

    // Log validation errors
    console.error('❌ Validation Failed:', JSON.stringify(errors.array(), null, 2));

    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg, // Return the first specific error message instead of generic 'Validation failed'
      errors: errors.array()
    });
  };
};

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user (Worker, User, or Contractor)
 * @access  Public
 */
router.post(
  '/register',
  catchUploadErrors(uploadFields([
    { name: 'governmentId', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ])),
  parseJsonFields(['address', 'services', 'skills']),
  validate(authSchema.registerSchema),
  authController.register
);

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
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP for login
 * @access  Public
 */
router.post('/verify-otp', validate(authSchema.loginOTPSchema), authController.verifyOTP);

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
 * @route   PATCH /api/auth/profile
 * @desc    Update current user profile
 * @access  Private
 */
router.patch('/profile', authenticate, authController.updateProfile);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user (standard /me endpoint)
 * @access  Private
 */
router.get('/me', authenticate, authController.getMe);

/**
 * @route   POST /api/auth/upload-profile-image
 * @desc    Upload profile image
 * @access  Private
 */
router.post(
  '/upload-profile-image',
  authenticate,
  catchUploadErrors(uploadSingle('image')),
  authController.uploadProfileImage
);

/**
 * @route   DELETE /api/auth/delete-profile-image
 * @desc    Delete profile image
 * @access  Private
 */
router.delete('/delete-profile-image', authenticate, authController.deleteProfileImage);

/**
 * @route   POST /api/auth/verify-registration
 * @desc    Verify registration OTP
 * @access  Public
 */
router.post('/verify-registration', validate(authSchema.loginOTPSchema), authController.verifyRegistration);

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend OTP for registration
 * @access  Public
 */
router.post('/resend-otp', validate(authSchema.sendOTPSchema), authController.resendOTP);

/**
 * @route   POST /api/auth/verify-device
 * @desc    Verify OTP for device binding
 * @access  Public
 */
router.post('/verify-device', validate(authSchema.verifyDeviceSchema), authController.verifyDevice);

module.exports = router;

