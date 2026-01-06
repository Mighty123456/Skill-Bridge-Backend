const validator = require('express-validator');

/**
 * Common validation rules
 */
const emailValidation = validator.body('email')
  .isEmail()
  .withMessage('Please provide a valid email address')
  .normalizeEmail();

const passwordValidation = validator.body('password')
  .isLength({ min: 6 })
  .withMessage('Password must be at least 6 characters long')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
  .optional();

const phoneValidation = validator.body('phone')
  .isMobilePhone()
  .withMessage('Please provide a valid phone number')
  .optional();

const nameValidation = validator.body('name')
  .trim()
  .isLength({ min: 2, max: 50 })
  .withMessage('Name must be between 2 and 50 characters')
  .matches(/^[a-zA-Z\s]+$/)
  .withMessage('Name can only contain letters and spaces')
  .optional();

/**
 * Validation middleware
 */
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validator.validationResult(req);
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

module.exports = {
  emailValidation,
  passwordValidation,
  phoneValidation,
  nameValidation,
  validate
};

