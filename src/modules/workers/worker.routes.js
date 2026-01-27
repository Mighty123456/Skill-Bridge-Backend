const express = require('express');
const router = express.Router();
const workerController = require('./worker.controller');
const { protect, authorize } = require('../../common/middleware/auth.middleware');

// Public / Protected Routes
router.get('/:id/passport', protect, workerController.getPassport);

// Admin / System Routes
router.post('/check-decay', protect, authorize('admin'), workerController.checkSkillDecay);

module.exports = router;
