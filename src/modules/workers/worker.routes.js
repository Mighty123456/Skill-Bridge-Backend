const express = require('express');
const router = express.Router();
const workerController = require('./worker.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');


// Public / Protected Routes
router.get('/nearby', protect, workerController.getNearbyWorkers);
router.get('/:id/passport', protect, workerController.getPassport);


// Admin / System Routes
router.post('/check-decay', protect, authorize('admin'), workerController.checkSkillDecay);

module.exports = router;
