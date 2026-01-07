const express = require('express');
const { validationResult } = require('express-validator');
const router = express.Router();

const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const { ROLES } = require('../../common/constants/roles');
const adminController = require('./admin.controller');
const authSchema = require('../auth/auth.schema');

// Reusable validate middleware (mirrors auth.routes validate)
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      if (typeof next === 'function') {
        return next();
      }
      return;
    }

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  };
};

// Admin login (role must be admin)
router.post('/login', validate(authSchema.loginSchema), adminController.adminLogin);

// List workers with optional verification status filter
router.get(
  '/workers',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listWorkers,
);

// Update worker verification status
router.patch(
  '/workers/:workerId/status',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateWorkerStatus,
);

module.exports = router;


