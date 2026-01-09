const express = require('express');
const router = express.Router();
const quotationController = require('./quotation.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// All quotation routes require authentication
router.use(authenticate);

// Worker can submit a quotation
router.post('/', authorize('worker'), quotationController.createQuotation);

// Tenant can view quotations for their job
router.get('/job/:jobId', authorize('user'), quotationController.getQuotationsByJob);

// Tenant can accept a quotation
router.patch('/:id/accept', authorize('user'), quotationController.acceptQuotation);

module.exports = router;
