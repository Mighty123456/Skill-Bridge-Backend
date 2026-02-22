const express = require('express');
const router = express.Router();
const paymentController = require('./payment.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

router.get('/stats', protect, authorize('admin'), paymentController.getFinancialStats);
router.get('/transactions', protect, authorize('admin'), paymentController.getAllTransactions);

// Stripe Checkout
router.post('/create-checkout-session', protect, paymentController.createCheckoutSession);
router.post('/create-job-session', protect, paymentController.createJobPaymentSession);
router.get('/job/:jobId', protect, paymentController.getJobPaymentDetails);
router.post('/settle', protect, authorize('admin'), paymentController.processSettlement);
router.get('/invoice/:paymentId', protect, paymentController.downloadInvoice);
router.get('/export', protect, authorize('admin'), paymentController.exportTransactions);

// Checkout Redirects (Mobile friendly)
router.get('/success', paymentController.stripeSuccess);
router.get('/cancel', paymentController.stripeCancel);

// Stripe Webhook (Stripe needs to call this without JWT)
router.post('/webhook', express.raw({ type: 'application/json' }), paymentController.handleStripeWebhook);

module.exports = router;
