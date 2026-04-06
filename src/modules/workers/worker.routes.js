const express = require('express');
const router = express.Router();
const workerController = require('./worker.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const rateLimit = require('express-rate-limit');
const config = require('../../config/env');

// Stricter rate limit for search queries (20 requests per 15 mins)
const searchLimiter = (req, res, next) => {
  if (config.NODE_ENV === 'development') return next();
  return rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many searches. Cool down.' }
  })(req, res, next);
};

// Public / Protected Routes
router.get('/nearby', protect, searchLimiter, workerController.getNearbyWorkers);
router.get('/:id/passport', protect, workerController.getPassport);

// Portfolio
router.get('/:workerId/portfolio', protect, workerController.getPortfolio);
router.post('/:workerId/portfolio', protect, workerController.addPortfolioItem);
router.delete('/portfolio/:id', protect, workerController.deletePortfolioItem);

// Availability
router.get('/:workerId/availability', protect, workerController.getAvailability);
router.put('/:workerId/availability', protect, workerController.updateAvailability);

// ETA & Reliability
router.get('/:workerId/eta-stats', protect, workerController.getEtaStats);
router.patch('/eta/:jobId', protect, workerController.updateEta);

// Admin / System Routes
router.post('/check-decay', protect, authorize('admin'), workerController.checkSkillDecay);


// Subscription
router.post('/subscribe', protect, authorize('worker'), workerController.subscribe);

// Phase 4: Workforce Scheduling
router.get('/project-tasks', protect, authorize('worker'), workerController.getProjectTasks);

const multer = require('multer');
const upload = multer();
router.put('/project-tasks/:jobId/:taskId/status', protect, authorize('worker'), upload.any(), workerController.updateWorkerTaskStatus);

// Clear Payout Error
router.post('/clear-payout-error', protect, authorize('worker'), workerController.clearPayoutError);

module.exports = router;
