const express = require('express');
const router = express.Router();
const jobController = require('./job.controller');
const { uploadMultiple, catchUploadErrors } = require('../../common/middleware/upload.middleware');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// Routes
router.get('/categories', protect, jobController.getJobCategories);
router.post('/', protect, catchUploadErrors(uploadMultiple('issue_photos', 5)), jobController.createJob);
router.get('/feed', protect, jobController.getWorkerFeed);
router.get('/my-jobs', protect, jobController.getWorkerJobs);
router.get('/posted-jobs', protect, jobController.getTenantJobs);
router.get('/:id', protect, jobController.getJob);
router.post('/:id/accept', protect, jobController.acceptJob);
router.post('/:id/submit-completion', protect, catchUploadErrors(uploadMultiple('completion_photos', 5)), jobController.submitCompletion);
router.post('/:id/confirm-completion', protect, jobController.confirmCompletion);
router.post('/:id/regenerate-otp', protect, jobController.regenerateOTP);

// Job Execution (Phase 4)
router.post('/:id/start', protect, authorize('worker'), jobController.startJob);
router.post('/:id/complete', protect, authorize('worker'), catchUploadErrors(uploadMultiple('completion_photos', 5)), jobController.completeJob);

module.exports = router;
