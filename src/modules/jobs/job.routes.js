const express = require('express');
const router = express.Router();
const jobController = require('./job.controller');
const { uploadMultiple, uploadSingle, uploadFields, catchUploadErrors } = require('../../common/middleware/upload.middleware');
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

// Job Execution Lifecycle
router.post('/:id/eta', protect, authorize('worker'), jobController.confirmEta);
router.post('/:id/journey', protect, authorize('worker'), jobController.startJourney);
router.post('/:id/arrive', protect, authorize('worker'), jobController.arrive);
router.post('/:id/start', protect, authorize('worker'), jobController.startJob); // New
router.post('/:id/delay', protect, authorize('worker'), jobController.reportDelay); // New
router.post('/:id/location', protect, authorize('worker'), jobController.updateLocation);
router.post('/:id/diagnosis', protect, authorize('worker'), jobController.submitDiagnosis);
router.post('/:id/approve-diagnosis', protect, authorize('user'), jobController.approveDiagnosis);
router.post('/:id/materials', protect, authorize('worker'), catchUploadErrors(uploadSingle('bill_proof')), jobController.requestMaterial);
router.post('/:id/materials/:requestId/respond', protect, authorize('user'), jobController.respondToMaterial);

const completionUpload = uploadFields([
    { name: 'completion_photos', maxCount: 5 },
    { name: 'signature', maxCount: 1 }
]);
router.post('/:id/complete', protect, authorize('worker'), catchUploadErrors(completionUpload), jobController.submitCompletion);
router.post('/:id/confirm-completion', protect, authorize('user'), jobController.confirmCompletion);

router.post('/:id/finalize', protect, jobController.finalizeJob);
router.post('/:id/cancel', protect, jobController.cancelJob); // New Cancellation Route
router.post('/:id/dispute', protect, authorize('user'), jobController.raiseDispute);
router.post('/:id/dispute/resolve', protect, authorize('admin', 'user'), jobController.resolveDispute);

router.post('/:id/warranty/claim', protect, authorize('user'), jobController.claimWarranty);
router.post('/:id/warranty/resolve', protect, authorize('worker', 'admin'), jobController.resolveWarranty);

// Documents
router.get('/:id/invoice', protect, jobController.getInvoice);
router.get('/:id/warranty-card', protect, jobController.getWarrantyCard);

module.exports = router;
