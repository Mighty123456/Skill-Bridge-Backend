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

// List professionals with optional verification status filter
router.get(
  '/professionals',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listProfessionals,
);

// Update professional verification status
router.patch(
  '/professionals/:id/status',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateProfessionalStatus,
);

// List all users (User, Worker, Contractor)
router.get(
  '/users',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listUsers,
);

// Delete user account
router.delete(
  '/users/:userId',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.deleteUser,
);

// Get dashboard statistics
router.get(
  '/stats',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getDashboardStats,
);

// Badge Management Routes
router.post(
  '/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.createBadge
);

router.get(
  '/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listBadges
);

router.post(
  '/workers/:workerId/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.assignBadge
);

router.delete(
  '/workers/:workerId/badges/:badgeId',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.removeBadge
);

// List all jobs
router.get(
  '/jobs',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listJobs
);

// List all quotations
router.get(
  '/quotations',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listQuotations
);

module.exports = router;


