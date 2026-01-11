const express = require('express');
const router = express.Router();
const jobController = require('./job.controller');
const { uploadMultiple, catchUploadErrors } = require('../../common/middleware/upload.middleware');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');

// Routes
router.post('/', protect, catchUploadErrors(uploadMultiple('issue_photos', 5)), jobController.createJob);
router.get('/feed', protect, jobController.getWorkerFeed);
router.get('/my-jobs', protect, jobController.getWorkerJobs);
router.get('/posted-jobs', protect, jobController.getTenantJobs);
router.get('/:id', protect, jobController.getJob);
router.post('/:id/accept', protect, jobController.acceptJob);

module.exports = router;
