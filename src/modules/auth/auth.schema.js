const { body } = require('express-validator');
const { ROLES } = require('../../common/constants/roles');

/**
 * Validation schemas for authentication routes
 */

// Register validation
const registerSchema = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('role')
    .isIn([ROLES.WORKER, ROLES.USER, ROLES.CONTRACTOR])
    .withMessage('Invalid role. Must be worker, user, or contractor'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number'),
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Please provide a valid date of birth')
    .custom((value) => {
      const birthDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 18) {
        throw new Error('You must be at least 18 years old');
      }
      return true;
    }),
  body('address.street').optional().trim(),
  body('address.city').optional().trim(),
  body('address.state').optional().trim(),
  body('address.pincode').optional().trim(),
  body('address.coordinates.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('address.coordinates.longitude').optional().isFloat({ min: -180, max: 180 }),
  body('services').optional().isArray().withMessage('Services must be an array'),
  body('skills').optional().isArray().withMessage('Skills must be an array'),
  body('experience').optional().isInt({ min: 0 }).withMessage('Experience must be a non-negative integer'),
];

// Login validation
const loginSchema = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

// Send OTP validation
const sendOTPSchema = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
];

// Login with OTP validation
const loginOTPSchema = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
];

// Reset password validation
const resetPasswordSchema = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
];

module.exports = {
  registerSchema,
  loginSchema,
  sendOTPSchema,
  loginOTPSchema,
  resetPasswordSchema,
};

