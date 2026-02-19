const Payment = require('./payment.model');
const Wallet = require('../wallet/wallet.model');
const logger = require('../../config/logger');
const config = require('../../config/env');
const stripeKey = config.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;
const PaymentService = require('./payment.service');
const WalletService = require('../wallet/wallet.service');
const Job = require('../jobs/job.model');
const JobService = require('../jobs/job.service');
const mongoose = require('mongoose');

/**
 * Get Platform Financial Stats (Admin)
 */
exports.getFinancialStats = async (req, res) => {
    try {
        const platformWallet = await WalletService.getPlatformWallet();

        // Detailed aggregated stats
        const jobStats = await Payment.aggregate([
            {
                $group: {
                    _id: '$type',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalEscrowResults = await Wallet.aggregate([
            { $group: { _id: null, totalEscrow: { $sum: '$escrowBalance' }, totalPending: { $sum: '$pendingBalance' } } }
        ]);

        // Mapping types to readable stats
        const getStat = (type) => jobStats.find(s => s._id === type)?.total || 0;

        const result = {
            totalPlatformBalance: platformWallet.balance,
            currentEscrowedFunds: totalEscrowResults[0]?.totalEscrow || 0,
            pendingPayouts: totalEscrowResults[0]?.totalPending || 0,
            totalCommission: getStat('commission'),
            totalRefunds: getStat('refund'),
            totalPayouts: getStat('payout'),
            totalTopups: getStat('topup')
        };

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        logger.error(`Failed to get financial stats: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get All Transactions (Admin)
 */
exports.getAllTransactions = async (req, res) => {
    try {
        const { type, page = 1, limit = 50, search } = req.query;
        const filter = {};
        if (type) filter.type = type;
        if (search) {
            filter.transactionId = { $regex: search, $options: 'i' };
        }

        const transactions = await Payment.find(filter)
            .populate('user', 'name email')
            .populate('worker', 'name email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        const total = await Payment.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: transactions,
            pagination: {
                total,
                page: Number(page),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error(`Failed to get transactions: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * STRIPE: Create Checkout Session
 * POST /api/payments/create-checkout-session
 */
exports.createCheckoutSession = async (req, res, next) => {
    try {
        const { amount } = req.body;
        if (!amount || amount < 100) {
            return res.status(400).json({ message: 'Minimum add-funds amount is ₹100' });
        }

        const session = await PaymentService.createStripeCheckoutSession(req.user._id, amount);
        res.status(200).json({
            success: true,
            sessionId: session.id,
            url: session.url
        });
    } catch (e) {
        next(e);
    }
};

/**
 * STRIPE: Create Checkout Session for Job Approval
 * POST /api/payments/create-job-session
 */
exports.createJobPaymentSession = async (req, res, next) => {
    try {
        const { jobId } = req.body;
        if (!jobId) return res.status(400).json({ message: 'Job ID is required' });

        const session = await PaymentService.createJobCheckoutSession(jobId, req.user._id);
        res.status(200).json({
            success: true,
            sessionId: session.id,
            url: session.url
        });
    } catch (e) {
        next(e);
    }
};

/**
 * STRIPE: Webhook Handler
 * POST /api/payments/webhook
 */
exports.handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    if (!stripe) {
        logger.error('Stripe is not configured. Webhook ignored.');
        return res.status(500).json({ message: 'Stripe not configured' });
    }

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        logger.error(`Webhook Signature Verification Failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const session_stripe = await mongoose.startSession();
    session_stripe.startTransaction();

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                const session = event.data.object;

                // Idempotency check
                const existingPayment = await Payment.findOne({ transactionId: session.id }).session(session_stripe);
                if (existingPayment) {
                    logger.info(`Stripe: Transaction ${session.id} already processed.`);
                    await session_stripe.abortTransaction();
                    return res.json({ received: true });
                }

                if (session.metadata.type === 'wallet_topup') {
                    const userId = session.metadata.userId;
                    const amount = Number(session.metadata.amount);

                    const payment = new Payment({
                        transactionId: session.id,
                        user: userId,
                        amount: amount,
                        type: 'topup',
                        status: 'completed',
                        paymentMethod: 'stripe',
                        gatewayResponse: { stripeSessionId: session.id }
                    });
                    await payment.save({ session: session_stripe });
                    await WalletService.creditWallet(userId, amount, session_stripe);
                }
                else if (session.metadata.type === 'job_payment') {
                    const jobId = session.metadata.jobId;
                    const amount = Number(session.metadata.amount);
                    await JobService.handleJobPaymentSuccess(jobId, amount, 'stripe', session.id, session_stripe);
                }
                break;

            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                const userId = failedPayment.metadata?.userId;

                if (userId) {
                    const payment = new Payment({
                        transactionId: failedPayment.id,
                        user: userId,
                        amount: failedPayment.amount / 100,
                        type: failedPayment.metadata?.type || 'topup',
                        status: 'failed',
                        paymentMethod: 'stripe',
                        gatewayResponse: { error: failedPayment.last_payment_error }
                    });
                    await payment.save({ session: session_stripe });

                    try {
                        const fraudDetectionService = require('../fraud/fraud-detection.service');
                        await fraudDetectionService.detectPaymentFailures(userId);
                    } catch (err) {
                        logger.error(`Fraud detection trigger failed: ${err.message}`);
                    }
                }
                break;

            default:
                logger.info(`Unhandled Stripe event type ${event.type}`);
        }

        await session_stripe.commitTransaction();
    } catch (err) {
        await session_stripe.abortTransaction();
        logger.error(`Stripe Webhook Processing Error: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message });
    } finally {
        session_stripe.endSession();
    }

    res.json({ received: true });
};

/**
 * Get Payment Details for a Job
 */
exports.getJobPaymentDetails = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const payment = await Payment.findOne({ job: jobId, type: 'escrow' })
            .sort({ createdAt: -1 })
            .lean();

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        const job = await Job.findById(jobId).populate('selected_worker_id', 'name').lean();
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const breakdown = await PaymentService.calculateBreakdown(
            job.diagnosis_report?.final_total_cost || 0,
            job.selected_worker_id?._id
        );

        res.status(200).json({
            success: true,
            data: {
                transactionId: payment.transactionId,
                paidAt: payment.createdAt,
                breakdown,
                jobTitle: job.job_title,
                workerName: job.selected_worker_id?.name || 'Worker'
            }
        });
    } catch (error) {
        next(error);
    }
};
