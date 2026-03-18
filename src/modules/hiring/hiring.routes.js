const express = require('express');
const router = express.Router();
const hiringController = require('./hiring.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// All hiring routes are protected
router.use(protect);

// Contractor sends request
router.post('/request', authorize('contractor'), hiringController.createHireRequest);

// Worker views pending requests
router.get('/requests', authorize('worker'), hiringController.getWorkerRequests);

// Worker responds to request
router.post('/respond', authorize('worker'), hiringController.respondToHireRequest);

module.exports = router;
