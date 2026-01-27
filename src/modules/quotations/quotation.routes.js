const express = require('express');
const router = express.Router();
const quotationController = require('./quotation.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const { protect } = require('../../common/middleware/auth.middleware'); // Assuming 'protect' is also from auth.middleware

// All quotation routes require authentication
router.use(authenticate);

// Public/Worker routes
router.get('/stats', protect, quotationController.getQuotationStats);
router.post('/', protect, quotationController.createQuotation);

// Tenant can view quotations for their job
router.get('/job/:jobId', authorize('user'), quotationController.getQuotationsByJob);

// Tenant can accept a quotation
router.patch('/:id/accept', authorize('user'), quotationController.acceptQuotation);

module.exports = router;
