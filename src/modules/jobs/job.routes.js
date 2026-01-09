const express = require('express');
const router = express.Router();
const jobController = require('./job.controller');
const { protect, authorize } = require('../../common/middleware/auth.middleware');

// Routes
router.post('/', protect, jobController.createJob);
router.get('/:id', protect, jobController.getJob);
router.post('/:id/accept', protect, jobController.acceptJob);

module.exports = router;
