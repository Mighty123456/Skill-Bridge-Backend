const express = require('express');
const router = express.Router();
const WalletController = require('./wallet.controller');
const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

/**
 * @route   GET /api/wallet
 * @desc    Get user's wallet info (balance)
 * @access  Private
 */
router.get('/', authenticate, WalletController.getMyWallet);

/**
 * @route   GET /api/wallet/me
 * @desc    Get user's wallet info (balance) - Alias for compatibility
 * @access  Private
 */
router.get('/me', authenticate, WalletController.getMyWallet);

/**
 * @route   POST /api/wallet/add-funds
 * @desc    Add funds to wallet (Mock/Testing)
 * @access  Private
 */
router.post('/add-funds', authenticate, WalletController.addFunds);

// Withdrawal
router.post('/withdraw', authenticate, WalletController.withdraw);
router.get('/history', authenticate, WalletController.getHistory);
router.get('/transactions', authenticate, WalletController.getHistory); // Alias for compatibility

// Admin Routes
router.get('/admin/withdrawals', authenticate, authorize('admin'), WalletController.getPendingWithdrawals);
router.patch('/admin/withdrawals/:id', authenticate, authorize('admin'), WalletController.processWithdrawal);

module.exports = router;
