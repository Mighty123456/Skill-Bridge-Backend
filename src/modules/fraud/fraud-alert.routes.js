const express = require('express');
const router = express.Router();
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const { ROLES } = require('../../common/constants/roles');
const fraudAlertController = require('./fraud-alert.controller');

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// Get fraud alerts with filters
router.get('/', fraudAlertController.getFraudAlerts);

// Get fraud statistics
router.get('/stats', fraudAlertController.getFraudStats);

// Get single fraud alert
router.get('/:id', fraudAlertController.getFraudAlert);

// Resolve fraud alert
router.post('/:id/resolve', fraudAlertController.resolveFraudAlert);

// Mark as investigating
router.post('/:id/investigate', fraudAlertController.investigateFraudAlert);

module.exports = router;
