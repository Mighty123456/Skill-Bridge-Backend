const WalletService = require('./wallet.service');
const PaymentService = require('../payments/payment.service');

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
 * Request Payout
 */
exports.withdraw = async (req, res, next) => {
    try {
        const { amount, type, bankDetails } = req.body; // type: 'instant' or 'standard'
        if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

        const withdrawal = await WalletService.requestWithdrawal(req.user._id, Number(amount), type, bankDetails);
        res.status(200).json({
            success: true,
            message: 'Withdrawal request submitted',
            data: withdrawal
        });
    } catch (e) {
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
                paymentMethod: p.paymentMethod
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
        res.status(200).json({
            success: true,
            message: `Withdrawal ${status} successfully`,
            data: withdrawal
        });
    } catch (e) {
        next(e);
    }
};
