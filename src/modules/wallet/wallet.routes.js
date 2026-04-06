const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const WalletController = require('./wallet.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// Rate limiter: max 5 withdrawal requests per user per 10 minutes
const config = require('../../config/env');
const withdrawLimiter = (req, res, next) => {
  if (config.NODE_ENV === 'development') return next();
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 5,
    keyGenerator: (req) => req.user?._id?.toString() || req.ip, // per-user, not per-IP
    message: { success: false, message: 'Too many withdrawal requests. Please wait 10 minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
  })(req, res, next);
};

/**
 * @route   GET /api/wallet
 * @desc    Get user's wallet info (balance) — primarily for workers
 * @access  Private
 */
router.get('/', authenticate, WalletController.getMyWallet);

/**
 * @route   GET /api/wallet/me
 * @desc    Get user's wallet info (balance) - Alias for compatibility
 * @access  Private
 */
router.get('/me', authenticate, WalletController.getMyWallet);

// Worker Withdrawal (role-guarded + rate-limited)
router.post('/withdraw', authenticate, authorize('worker'), withdrawLimiter, WalletController.withdraw);
router.get('/verify', authenticate, WalletController.verifyTopup);
router.get('/history', authenticate, WalletController.getHistory);
router.get('/transactions', authenticate, WalletController.getHistory); // Alias for compatibility
router.get('/payout-status', authenticate, WalletController.getPayoutStatus);
router.get('/earnings-stats', authenticate, WalletController.getEarningsStats);

// Contractor Wallet Top-up
router.post('/topup', authenticate, authorize('contractor'), WalletController.addFunds);

// Contractor Escrow Operations
router.post('/escrow/lock', authenticate, authorize('contractor'), WalletController.lockEscrow);
router.post('/escrow/release', authenticate, authorize('contractor'), WalletController.releaseEscrow);
router.get('/escrow/project/:projectId', authenticate, WalletController.getProjectEscrows);

// Transaction Details
router.get('/transactions/:transactionId/invoice', authenticate, WalletController.getInvoice);

// Export Transactions
router.get('/transactions/export', authenticate, WalletController.exportTransactions);
router.get('/transactions/download', WalletController.downloadExport);

// Admin Routes
router.get('/admin/withdrawals', authenticate, authorize('admin'), WalletController.getPendingWithdrawals);
router.patch('/admin/withdrawals/:id', authenticate, authorize('admin'), WalletController.processWithdrawal);

module.exports = router;
