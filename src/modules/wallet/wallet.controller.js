const WalletService = require('./wallet.service');
const PaymentService = require('../payments/payment.service');
const { logAdminAction } = require('../../common/utils/admin-logger');

/**
 * Get current user's wallet
 */
exports.getMyWallet = async (req, res, next) => {
    try {
        const wallet = await WalletService.getWallet(req.user._id);
        res.status(200).json({
            success: true,
            data: wallet
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Add funds to wallet via Stripe
 */
exports.addFunds = async (req, res, next) => {
    try {
        const { amount } = req.body;
        if (!amount || isNaN(amount) || amount < 100) {
            return res.status(400).json({ success: false, message: 'Minimum amount is ₹100' });
        }

        const session = await PaymentService.createStripeCheckoutSession(req.user._id, Number(amount));

        res.status(200).json({
            success: true,
            message: 'Checkout session created',
            sessionId: session.id,
            url: session.url
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Lock funds in escrow for a project
 */
exports.lockEscrow = async (req, res, next) => {
    try {
        const { projectId, workerId, amount, description } = req.body;
        if (!projectId || !workerId || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid project, worker, or amount' });
        }

        const result = await WalletService.lockEscrow(req.user._id, projectId, workerId, Number(amount), description);
        
        res.status(200).json({
            success: true,
            message: 'Funds locked in escrow successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get all escrows for a project
 */
exports.getProjectEscrows = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const escrows = await WalletService.getProjectEscrows(projectId);
        res.status(200).json({
            success: true,
            data: escrows
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Release escrowed funds to a worker
 */
exports.releaseEscrow = async (req, res, next) => {
    try {
        const { escrowId, projectId } = req.body;
        if (!escrowId && !projectId) {
            return res.status(400).json({ success: false, message: 'escrowId or projectId is required' });
        }

        let jobId = projectId;
        if (escrowId) {
            const Payment = require('../payments/payment.model');
            const payment = await Payment.findById(escrowId);
            if (!payment) return res.status(404).json({ success: false, message: 'Escrow record not found' });
            if (payment.user.toString() !== req.user._id.toString()) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }
            jobId = payment.job;
        }

        const result = await PaymentService.releasePayment(jobId);
        
        res.status(200).json({
            success: true,
            message: 'Funds released successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get Invoice for a transaction (For compatibility with Flutter side)
 */
exports.getInvoice = async (req, res, next) => {
    try {
        const { transactionId } = req.params;
        
        // Find payment by its ID (as sent from Flutter) OR its transactionId field
        const Payment = require('../payments/payment.model');
        const payment = await Payment.findOne({
            $or: [
                { _id: require('mongoose').Types.ObjectId.isValid(transactionId) ? transactionId : null },
                { transactionId: transactionId }
            ]
        });

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Transaction not found for invoice' });
        }

        // Reuse the existing downloadInvoice logic from payment controller
        const paymentController = require('../payments/payment.controller');
        req.params.paymentId = payment._id.toString();
        return paymentController.downloadInvoice(req, res, next);
    } catch (error) {
        next(error);
    }
};

/**
 * Request Payout / Manual Withdrawal
 */
exports.withdraw = async (req, res, next) => {
    try {
        const { amount, type, payoutMethod, bankDetails } = req.body;
        
        // Default to manual if not specified
        const method = ['stripe', 'manual'].includes(payoutMethod) ? payoutMethod : 'manual';

        // Parse amount robustly (Flutter sends as number, web may send as string)
        const parsedAmount = parseFloat(amount);

        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid amount. Please enter a positive number.'
            });
        }

        if (parsedAmount < 100) {
            return res.status(400).json({
                success: false,
                message: 'Minimum withdrawal amount is ₹100.'
            });
        }

        const withdrawal = await WalletService.requestWithdrawal(
            req.user._id,
            parsedAmount,
            type || 'standard',
            method,
            bankDetails
        );

        res.status(200).json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: withdrawal
        });
    } catch (e) {
        // Catch service-level errors (Insufficient funds, etc.) and return them
        // cleanly instead of letting next(e) produce a generic 500.
        if (e.message && (e.message.includes('Insufficient') || e.message.includes('low to cover'))) {
            return res.status(400).json({ success: false, message: e.message });
        }
        next(e);
    }
};


/**
 * Get Transaction History (Payments + Withdrawals)
 */
exports.getHistory = async (req, res, next) => {
    try {
        const Payment = require('../payments/payment.model');
        const Withdrawal = require('./withdrawal.model');
        const { type, limit = 50 } = req.query;

        // Get payments
        const paymentQuery = { 
            $or: [
                { user: req.user._id },
                { worker: req.user._id }
            ]
        };
        if (type) {
            paymentQuery.type = type;
        }

        const payments = await Payment.find(paymentQuery)
            .populate('job', 'job_title')
            .populate('user', 'name')
            .populate('worker', 'name')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        // Get withdrawals
        const withdrawals = await Withdrawal.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        // Combine and sort by date
        const allTransactions = [
            ...payments.map(p => ({
                id: p._id,
                type: 'payment',
                transactionType: p.type,
                amount: p.amount,
                status: p.status,
                description: p.type === 'escrow' ? `Escrow for job` : 
                           p.type === 'payout' ? `Payment received` :
                           p.type === 'topup' ? `Wallet top-up` :
                           p.type === 'refund' ? `Refund` : p.type,
                jobTitle: p.job?.job_title,
                transactionId: p.transactionId,
                createdAt: p.createdAt,
                paymentMethod: p.paymentMethod,
                breakdown: p.gatewayResponse?.breakdown || {}
            })),
            ...withdrawals.map(w => ({
                id: w._id,
                type: 'withdrawal',
                transactionType: 'withdrawal',
                amount: w.amount,
                netAmount: w.netAmount,
                fee: w.fee,
                status: w.status,
                description: `Withdrawal (${w.type})`,
                createdAt: w.createdAt,
                processedAt: w.processedAt
            }))
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ 
            success: true, 
            count: allTransactions.length,
            data: allTransactions 
        });
    } catch (e) {
        next(e);
    }
};

const crypto = require('crypto');
const exportTokens = new Map();

/**
 * Generate a tokenized download URL for transaction export
 */
exports.exportTransactions = async (req, res, next) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        
        // Store query details with user ID to build history later
        const exportData = {
            userId: req.user._id,
            query: req.query,
            expiresAt: Date.now() + 5 * 60 * 1000 // Valid for 5 minutes
        };
        exportTokens.set(token, exportData);

        const config = require('../../config/env');
        const baseUrl = config.API_URL || `${req.protocol}://${req.get('host')}`;
        
        res.status(200).json({
            success: true,
            downloadUrl: `/wallet/transactions/download?token=${token}`
        });
    } catch (e) {
        next(e);
    }
};

/**
 * Download CSV file for transaction export
 */
exports.downloadExport = async (req, res, next) => {
    try {
        const { token } = req.query;
        if (!token || !exportTokens.has(token)) {
            return res.status(400).send('Invalid or expired export token');
        }

        const exportData = exportTokens.get(token);
        if (Date.now() > exportData.expiresAt) {
            exportTokens.delete(token);
            return res.status(400).send('Export token expired');
        }

        const { userId, query } = exportData;
        
        const Payment = require('../payments/payment.model');
        const Withdrawal = require('./withdrawal.model');
        const { type } = query;
        
        const paymentQuery = { 
            $or: [{ user: userId }, { worker: userId }]
        };
        if (type) paymentQuery.type = type;

        const payments = await Payment.find(paymentQuery)
            .populate('job', 'job_title')
            .sort({ createdAt: -1 })
            .lean();

        const withdrawals = await Withdrawal.find({ user: userId })
            .sort({ createdAt: -1 })
            .lean();

        // Combine and sort by date
        const allTransactions = [
            ...payments.map(p => ({
                date: p.createdAt,
                type: 'payment',
                subType: p.type,
                amount: p.amount,
                status: p.status,
                description: p.type === 'escrow' ? `Escrow for job` : 
                           p.type === 'payout' ? `Payment received` :
                           p.type === 'topup' ? `Wallet top-up` :
                           p.type === 'refund' ? `Refund` : p.type,
                transactionId: p.transactionId || 'N/A'
            })),
            ...withdrawals.map(w => ({
                date: w.createdAt,
                type: 'withdrawal',
                subType: w.type,
                amount: w.amount,
                status: w.status,
                description: `Withdrawal (${w.type})`,
                transactionId: 'N/A'
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Generate CSV string
        let csv = 'Date,Type,Description,Amount,Status,Transaction ID\n';
        allTransactions.forEach(t => {
            const date = new Date(t.date).toLocaleString().replace(/,/g, '');
            const description = `"${t.description.replace(/"/g, '""')}"`;
            csv += `${date},${t.subType},${description},${t.amount},${t.status},${t.transactionId}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=transactions_export.csv');
        res.status(200).send(csv);

        // Consume token
        exportTokens.delete(token);
    } catch (e) {
        console.error("Download Error:", e);
        res.status(500).send('Error generating export');
    }
};

/**
 * Get Stripe Payout Status
 */
exports.getPayoutStatus = async (req, res, next) => {
    try {
        const payouts = await PaymentService.getStripePayouts(req.user._id);
        res.status(200).json({
            success: true,
            data: payouts
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get Weekly Earnings Stats for Worker
 */
exports.getEarningsStats = async (req, res, next) => {
    try {
        const stats = await WalletService.getEarningsStats(req.user._id);
        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        next(error);
    }
};

/**
 * ADMIN: Get Pending Withdrawals
 */
exports.getPendingWithdrawals = async (req, res, next) => {
    try {
        const { status } = req.query; // optional: pending, completed, rejected
        const filters = status ? { status } : { status: 'pending' };
        const withdrawals = await WalletService.getAllWithdrawals(filters);
        res.status(200).json({ success: true, count: withdrawals.length, data: withdrawals });
    } catch (e) {
        next(e);
    }
};

/**
 * ADMIN: Approve/Reject Withdrawal
 */
exports.processWithdrawal = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body; // status: 'completed' or 'rejected'

        if (!['completed', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const withdrawal = await WalletService.processWithdrawal(id, req.user._id, status, notes);

        await logAdminAction(req.user._id, `withdrawal_${status}`, id, 'payment', `Withdrawal ${id} was ${status}. Notes: ${notes || 'None'}`, req.ip);

        res.status(200).json({
            success: true,
            message: `Withdrawal ${status} successfully`,
            data: withdrawal
        });
    } catch (e) {
        next(e);
    }
};
