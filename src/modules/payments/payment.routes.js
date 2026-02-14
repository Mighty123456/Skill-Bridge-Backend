const express = require('express');
const router = express.Router();
const paymentController = require('./payment.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

router.get('/stats', protect, authorize('admin'), paymentController.getFinancialStats);
router.get('/transactions', protect, authorize('admin'), paymentController.getAllTransactions);

module.exports = router;
