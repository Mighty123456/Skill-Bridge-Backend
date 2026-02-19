const express = require('express');
const router = express.Router();
const workerController = require('./worker.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');


// Public / Protected Routes
router.get('/nearby', protect, workerController.getNearbyWorkers);
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

module.exports = router;
