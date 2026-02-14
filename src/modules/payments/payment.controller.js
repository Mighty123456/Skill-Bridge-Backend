const Payment = require('./payment.model');
const Wallet = require('../wallet/wallet.model');
const logger = require('../../config/logger');

/**
 * Get Platform Financial Stats (Admin)
 */
exports.getFinancialStats = async (req, res) => {
    try {
        const stats = await Payment.aggregate([
            {
                $group: {
                    _id: null,
                    totalPlatformBalance: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] }
                    },
                    totalCommission: {
                        $sum: { $cond: [{ $eq: ['$type', 'commission'] }, '$amount', 0] }
                    },
                    pendingPayouts: {
                        $sum: { $cond: [{ $and: [{ $eq: ['$type', 'payout'] }, { $eq: ['$status', 'pending'] }] }, '$amount', 0] }
                    },
                    totalRefunds: {
                        $sum: { $cond: [{ $eq: ['$type', 'refund'] }, '$amount', 0] }
                    }
                }
            }
        ]);

        const result = stats[0] || {
            totalPlatformBalance: 0,
            totalCommission: 0,
            pendingPayouts: 0,
            totalRefunds: 0
        };

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error(`Get Financial Stats Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch financial statistics' });
    }
};

/**
 * Get All Transactions (Admin with filters)
 */
exports.getAllTransactions = async (req, res) => {
    try {
        const { type, status, search } = req.query;
        let query = {};

        if (type) query.type = type;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { transactionId: { $regex: search, $options: 'i' } },
                { 'job.id': search } // Simplified, usually need to handle ObjectId correctly
            ];
        }

        const transactions = await Payment.find(query)
            .populate('user', 'name email')
            .populate('worker', 'name')
            .sort({ createdAt: -1 })
            .limit(100);

        res.status(200).json({
            success: true,
            count: transactions.length,
            data: transactions
        });
    } catch (error) {
        logger.error(`Get Transactions Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
};

/**
 * Handle Escrow Deposit
 */
exports.depositEscrow = async (req, res) => {
    // Logic for depositing funds into escrow when a job is assigned
    // This would typically interface with a payment gateway
};
