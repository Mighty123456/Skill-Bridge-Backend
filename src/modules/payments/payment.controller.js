const Payment = require('./payment.model');
const Wallet = require('../wallet/wallet.model');
const logger = require('../../config/logger');
const config = require('../../config/env');
const getStripe = () => {
    const stripeKey = config.STRIPE_SECRET_KEY;
    if (!stripeKey) return null;
    return require('stripe')(stripeKey);
};
const PaymentService = require('./payment.service');
const WalletService = require('../wallet/wallet.service');
const Job = require('../jobs/job.model');
const JobService = require('../jobs/job.service');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const mongoose = require('mongoose');
const { logAdminAction } = require('../../common/utils/admin-logger');

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

        // Active escrow from Payment records (not wallet balances)
        const escrowResults = await Payment.aggregate([
            { $match: { type: 'escrow', status: 'completed' } },
            { $group: { _id: null, totalEscrow: { $sum: '$amount' } } }
        ]);

        const totalPendingResults = await Wallet.aggregate([
            { $group: { _id: null, totalPending: { $sum: '$pendingBalance' } } }
        ]);

        // Calculate Tax Liability (Sum all GST collected in gatewayResponse.breakdown)
        const taxResults = await Payment.aggregate([
            { 
                $match: { 
                    status: { $in: ['completed', 'released'] },
                    'gatewayResponse.breakdown.totalGST': { $exists: true }
                } 
            },
            { 
                $group: { 
                    _id: null, 
                    totalTax: { $sum: '$gatewayResponse.breakdown.totalGST' } 
                } 
            }
        ]);

        // Mapping types to readable stats
        const getStat = (type) => jobStats.find(s => s._id === type)?.total || 0;

        const result = {
            totalPlatformBalance: platformWallet.balance,
            currentEscrowedFunds: escrowResults[0]?.totalEscrow || 0,
            pendingPayouts: totalPendingResults[0]?.totalPending || 0,
            totalCommission: getStat('commission'),
            totalTaxCollected: taxResults[0]?.totalTax || 0,
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

        const protocol = req.protocol;
        const host = req.get('host');
        const backEndUrl = `${protocol}://${host}/api/payments`;

        const session = await PaymentService.createStripeCheckoutSession(req.user._id, amount, backEndUrl);
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
        logger.info(`💸 createJobPaymentSession triggered for job: ${jobId}`);
        if (!jobId) return res.status(400).json({ message: 'Job ID is required' });

        const protocol = req.protocol;
        const host = req.get('host');
        const backEndUrl = `${protocol}://${host}/api/payments`;

        const session = await PaymentService.createJobCheckoutSession(jobId, req.user._id, backEndUrl);
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

    const stripe = getStripe();
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
        logger.info(`📦 Processing Stripe Event: ${event.type}`);

        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
                const session = event.data.object;
                logger.info(`✅ Stripe Checkout Session completed: ${session.id} for type: ${session.metadata?.type}`);

                // Idempotency check
                const existingPayment = await Payment.findOne({ transactionId: session.id }).session(session_stripe);
                if (existingPayment) {
                    logger.info(`Stripe: Transaction ${session.id} already processed.`);
                    await session_stripe.abortTransaction();
                    return res.json({ received: true });
                }

                if (session.metadata?.type === 'wallet_topup') {
                    const userId = session.metadata.userId;
                    const amount = Number(session.metadata.amount);

                    const payment = new Payment({
                        transactionId: session.id,
                        user: userId,
                        amount: amount,
                        type: 'topup',
                        status: 'completed',
                        paymentMethod: 'stripe',
                        gatewayResponse: {
                            stripeSessionId: session.id,
                            paymentIntentId: session.payment_intent,
                            customerEmail: session.customer_details?.email
                        }
                    });
                    await payment.save({ session: session_stripe });
                    await WalletService.creditWallet(userId, amount, session_stripe);
                }
                else if (session.metadata?.type === 'job_payment') {
                    const jobId = session.metadata.jobId;
                    const amount = Number(session.metadata.amount);
                    logger.info(`💸 finalizing job payment for job: ${jobId}, amount: ${amount}`);
                    await JobService.handleJobPaymentSuccess(jobId, amount, 'stripe', session.id, session_stripe, session.payment_intent);
                }
                else if (session.metadata?.type === 'material_payment') {
                    const jobId = session.metadata.jobId;
                    const amount = Number(session.metadata.amount);
                    const requestId = session.metadata.requestId;
                    logger.info(`💸 Material payment received for job: ${jobId}, amount: ${amount}`);

                    // Record material escrow (with payment_intent for refunds)
                    await PaymentService.createMaterialEscrow(jobId, session.metadata.userId, amount, 'stripe', session.id, session_stripe, session.payment_intent);

                    // Update the material request status to approved
                    const job = await Job.findById(jobId).session(session_stripe);
                    if (job && requestId) {
                        const request = job.material_requests.id(requestId);
                        if (request) {
                            request.status = 'approved';
                            request.responded_at = new Date();
                        }
                        // Resume job if no more pending material requests
                        const hasPending = job.material_requests.some(r => r.status === 'pending' || r.status === 'payment_pending');
                        if (!hasPending) {
                            job.status = 'in_progress';
                        }
                        await job.save({ session: session_stripe });
                    }
                }
                break;

            case 'charge.refunded':
                const refund = event.data.object;
                const refundAmount = refund.amount_refunded / 100;
                const chargeId = refund.id;
                await PaymentService.handleExternalRefund(chargeId, refundAmount, session_stripe);
                break;

            case 'charge.dispute.created':
                const dispute = event.data.object;
                const disputedChargeId = dispute.charge;
                const disputePayment = await Payment.findOne({
                    $or: [
                        { transactionId: disputedChargeId },
                        { 'gatewayResponse.chargeId': disputedChargeId }
                    ]
                }).session(session_stripe);

                if (disputePayment) {
                    const FraudDetectionService = require('../fraud/fraud-detection.service');
                    await FraudDetectionService.createAlert({
                        type: 'payment_dispute',
                        severity: 'critical',
                        userId: disputePayment.user,
                        title: 'Stripe Payment Dispute Created',
                        description: `A dispute has been opened for transaction ${disputedChargeId} (Amount: ₹${dispute.amount / 100})`,
                        metadata: {
                            disputeId: dispute.id,
                            chargeId: disputedChargeId,
                            reason: dispute.reason,
                            status: dispute.status,
                            detectionSource: 'stripe_webhook'
                        }
                    });

                    // Auto-mark job as disputed if not already
                    if (disputePayment.job) {
                        const job = await Job.findById(disputePayment.job).session(session_stripe);
                        if (job && !job.dispute.is_disputed) {
                            job.dispute.is_disputed = true;
                            job.dispute.reason = `External Chargeback: ${dispute.reason}`;
                            job.dispute.opened_at = new Date();
                            job.status = 'disputed';
                            await job.save({ session: session_stripe });
                        }
                    }
                }
                break;

            case 'charge.dispute.closed':
                const closedDispute = event.data.object;
                const closedChargeId = closedDispute.charge;
                const status = closedDispute.status; // won, lost

                const closedDisputePayment = await Payment.findOne({
                    $or: [
                        { transactionId: closedChargeId },
                        { 'gatewayResponse.chargeId': closedChargeId }
                    ]
                }).session(session_stripe);

                if (closedDisputePayment && closedDisputePayment.job) {
                    const job = await Job.findById(closedDisputePayment.job).session(session_stripe);
                    if (job) {
                        job.dispute.status = 'closed';
                        job.dispute.resolved_at = new Date();
                        job.dispute.resolution_note = `Stripe Dispute Closed: ${status.toUpperCase()}`;
                        
                        // If we won, we might want to release payment. If we lost, it's already gone.
                        if (status === 'won') {
                            job.status = 'completed';
                        } else {
                            job.status = 'cancelled';
                        }
                        await job.save({ session: session_stripe });
                    }
                }
                break;

            case 'charge.dispute.funds_withdrawn':
                logger.warn(`💸 Funds withdrawn for dispute on charge ${event.data.object.charge}`);
                break;

            case 'charge.dispute.funds_reinstated':
                logger.info(`💰 Funds reinstated for won dispute on charge ${event.data.object.charge}`);
                break;

            case 'payment_intent.payment_failed':
                const failedPayment = event.data.object;
                const failUserId = failedPayment.metadata?.userId;

                if (failUserId) {
                    const payment = new Payment({
                        transactionId: failedPayment.id,
                        user: failUserId,
                        amount: failedPayment.amount / 100,
                        type: failedPayment.metadata?.type || 'topup',
                        status: 'failed',
                        paymentMethod: 'stripe',
                        gatewayResponse: { error: failedPayment.last_payment_error }
                    });
                    await payment.save({ session: session_stripe });

                    try {
                        const FraudDetectionService = require('../fraud/fraud-detection.service');
                        await FraudDetectionService.detectPaymentFailures(failUserId);
                    } catch (err) {
                        logger.error(`Fraud detection trigger failed: ${err.message}`);
                    }
                }
                break;

            case 'checkout.session.expired':
                const expiredSession = event.data.object;
                logger.info(`Stripe Checkout Session ${expiredSession.id} expired.`);
                break;

            case 'account.updated':
                const account = event.data.object;
                logger.info(`👤 Stripe Account Updated: ${account.id}`);
                
                const worker = await Worker.findOne({ stripeAccountId: account.id }).session(session_stripe);
                if (worker) {
                    const chargesEnabled = account.charges_enabled;
                    const payoutsEnabled = account.payouts_enabled;
                    const detailsSubmitted = account.details_submitted;

                    // Sync status
                    worker.stripeOnboarded = detailsSubmitted && payoutsEnabled;
                    worker.payoutEnabled = payoutsEnabled;

                    if (!payoutsEnabled && account.requirements?.eventually_due?.length > 0) {
                        worker.lastPayoutError = `Restricted: ${account.requirements.eventually_due.join(', ')}`;
                    } else if (payoutsEnabled) {
                        worker.lastPayoutError = null;
                        worker.consecutivePayoutFailures = 0;
                    }

                    await worker.save({ session: session_stripe });
                    
                    if (worker.stripeOnboarded && !worker.payoutEnabled) {
                        logger.info(`✅ Worker ${worker.user} verified but payouts still pending Stripe approval.`);
                    } else if (worker.stripeOnboarded && worker.payoutEnabled) {
                        logger.info(`✅ Worker ${worker.user} fully active for Stripe Connect.`);
                        await notifyHelper.onStripeOnboarded(worker.user);
                    }
                }
                break;

            case 'payout.paid':
                const paidPayout = event.data.object;
                logger.info(`💰 Stripe Payout Succeeded: ${paidPayout.id} for account ${event.account}`);
                
                // Track back to internal withdrawal if possible
                const Withdrawal = require('../wallet/withdrawal.model');
                const withdrawal = await Withdrawal.findOne({ stripeTransferId: paidPayout.id }).session(session_stripe);
                if (withdrawal) {
                    withdrawal.status = 'processed';
                    withdrawal.processedAt = new Date();
                    await withdrawal.save({ session: session_stripe });
                }
                break;

            case 'payout.failed':
                const failedPayout = event.data.object;
                logger.error(`❌ Stripe Payout Failed: ${failedPayout.id} - ${failedPayout.failure_code}`);
                
                const fWithdrawal = await Withdrawal.findOne({ stripeTransferId: failedPayout.id }).session(session_stripe);
                if (fWithdrawal) {
                    fWithdrawal.status = 'failed';
                    fWithdrawal.failureReason = failedPayout.failure_message;
                    await fWithdrawal.save({ session: session_stripe });
                    
                    // Notify worker
                    const fWorker = await Worker.findOne({ user: fWithdrawal.user }).session(session_stripe);
                    if (fWorker) {
                        fWorker.lastPayoutError = `Bank payout failed: ${failedPayout.failure_message}`;
                        await fWorker.save({ session: session_stripe });
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

/**
 * Process Partial Settlement (Admin Only)
 */
exports.processSettlement = async (req, res, next) => {
    try {
        const { jobId, workerAmount, tenantAmount, notes } = req.body;

        if (!jobId || workerAmount === undefined || tenantAmount === undefined) {
            return res.status(400).json({ success: false, message: 'jobId, workerAmount, and tenantAmount are required' });
        }

        const result = await PaymentService.processSettlement(
            jobId,
            Number(workerAmount),
            Number(tenantAmount),
            req.user._id,
            notes
        );

        await logAdminAction(req.user._id, 'partial_settlement', jobId, 'job', `Manually settled job ${jobId}. Worker: ₹${workerAmount}, Tenant Refund: ₹${tenantAmount}.`, req.ip);

        res.status(200).json({
            success: true,
            message: 'Settlement processed successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Download Invoice for a payment (Tenant / Admin)
 */
exports.downloadInvoice = async (req, res, next) => {
    try {
        const { paymentId } = req.params;
        const InvoiceService = require('./invoice.service');

        // Validate ObjectId to avoid Mongoose cast errors
        if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
            return res.status(400).json({ message: 'Invalid payment ID' });
        }

        const payment = await Payment.findById(paymentId).lean();
        if (!payment) return res.status(404).json({ message: 'Payment not found' });

        // Security check: Only the involved user or admin can download
        const paymentUserId = payment.user?.toString?.() || payment.user;
        if (paymentUserId !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Unauthorized access to invoice' });
        }

        const user = await User.findById(payment.user).lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found for this payment' });
        }

        let pdfBuffer;

        if (payment.job) {
            const job = await Job.findById(payment.job).populate('selected_worker_id', 'name').lean();
            if (!job) {
                logger.warn(`Invoice: Job ${payment.job} not found for payment ${paymentId}`);
                return res.status(404).json({ message: 'Associated job not found' });
            }
            pdfBuffer = await InvoiceService.generateTenantInvoice(payment, job, user);
        } else {
            // Top-up, payout, or other payment types without a job
            const desc = payment.type === 'topup' ? 'Wallet Top-up' : payment.type === 'payout' ? 'Service Payout' : payment.type;
            pdfBuffer = await InvoiceService.generateSimpleInvoice(payment, user, desc);
        }

        const invSuffix = (payment.transactionId || payment._id?.toString() || 'INV').slice(-8).toUpperCase();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=SB_Invoice_${invSuffix}.pdf`);
        res.status(200).send(pdfBuffer);
    } catch (error) {
        logger.error(`Invoice download error: ${error.message}`);
        next(error);
    }
};

/**
 * Export Transactions as CSV (Admin Only)
 */
exports.exportTransactions = async (req, res, next) => {
    try {
        const transactions = await Payment.find({})
            .populate('user', 'name email')
            .populate('worker', 'name email')
            .sort({ createdAt: -1 })
            .lean();

        if (!transactions.length) return res.status(404).json({ message: 'No transactions to export' });

        // Define headers
        const headers = ['Date', 'Transaction ID', 'Type', 'Amount', 'Currency', 'Status', 'User Name', 'User Email', 'Worker Name', 'Job ID'];

        // Map rows
        const rows = transactions.map(t => [
            new Date(t.createdAt).toISOString(),
            t.transactionId,
            t.type,
            t.amount,
            t.currency,
            t.status,
            t.user?.name || 'N/A',
            t.user?.email || 'N/A',
            t.worker?.name || 'N/A',
            t.job?.toString() || 'N/A'
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));

        const csvContent = [headers.join(','), ...rows].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=SB_Transactions_${new Date().toISOString().split('T')[0]}.csv`);
        res.status(200).send(csvContent);
    } catch (error) {
        next(error);
    }
};

/**
 * Handle Stripe Success Redirect
 * This is called by Stripe when the user successfully completes a payment.
 * We serve a simple HTML page instead of redirecting to the local frontend,
 * making it more reliable for mobile apps.
 */
exports.stripeSuccess = async (req, res) => {
    const { jobId, type, session_id } = req.query;

    let redirectText = "Payment Successful!";
    let subText = "Your payment has been processed and secured in escrow.";

    if (type === 'wallet_topup') {
        redirectText = "Wallet Top-up Successful!";
        subText = "Funds have been added to your professional wallet.";
    }

    // Append session info to deep link
    const deepLink = `skillbridge://payment/success?session_id=${session_id || ''}&jobId=${jobId || ''}&type=${type || ''}`;

    res.send(`
        <html>
            <head>
                <title>Success</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f7fafc; color: #2d3748; }
                    .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; width: 90%; }
                    .icon { color: #48bb78; font-size: 4rem; margin-bottom: 1.5rem; }
                    h1 { margin: 0 0 1rem 0; font-size: 1.5rem; font-weight: 700; color: #1a202c; }
                    p { margin: 0 0 2rem 0; color: #718096; line-height: 1.5; }
                    .btn { background-color: #008080; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; display: inline-block; transition: background-color 0.2s; }
                    .btn:hover { background-color: #006666; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>${redirectText}</h1>
                    <p>${subText}</p>
                    <a href="${deepLink}" class="btn">Return to App</a>
                    <script>
                        // Auto-redirect attempt after 2 seconds
                        setTimeout(function() {
                            window.location.href = "${deepLink}";
                        }, 2000);
                    </script>
                </div>
            </body>
        </html>
    `);
};

/**
 * Handle Stripe Cancel Redirect
 */
exports.stripeCancel = async (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Cancelled</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f7fafc; color: #2d3748; }
                    .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; width: 90%; }
                    .icon { color: #e53e3e; font-size: 4rem; margin-bottom: 1.5rem; }
                    h1 { margin: 0 0 1rem 0; font-size: 1.5rem; font-weight: 700; color: #1a202c; }
                    p { margin: 0 0 2rem 0; color: #718096; line-height: 1.5; }
                    .btn { background-color: #718096; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 600; display: inline-block; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✕</div>
                    <h1>Payment Cancelled</h1>
                    <p>The checkout process was cancelled. No funds were charged.</p>
                    <a href="skillbridge://payment/cancel" class="btn">Return to App</a>
                </div>
            </body>
        </html>
    `);
};
/**
 * Force Verify Payment Status (App Fallback)
 */
exports.verifyJobPayment = async (req, res, next) => {
    try {
        const { jobId } = req.params;
        const { session_id } = req.query;
        logger.info(`🔍 verifyJobPayment triggered for job: ${jobId}, Session: ${session_id || 'NONE'}`);

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ message: 'Job not found' });

        // Security: Only the job owner (tenant) or assigned worker can verify
        if (job.user_id.toString() !== req.user.id && job.selected_worker_id?.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized to verify this job payment' });
        }

        if (job.status === 'diagnosed') {
            return res.json({
                success: true,
                status: 'diagnosed',
                message: 'Payment verified: Job is ready to start.'
            });
        }

        // 1. Check if a payment record already exists in our DB
        const payment = await Payment.findOne({
            job: jobId,
            type: 'escrow',
            status: 'completed'
        });

        if (payment) {
            if (job.status !== 'diagnosed') {
                logger.info(`🛠️ Self-correcting job status for ${jobId}`);
                await JobService.handleJobPaymentSuccess(jobId, payment.amount);
            }
            return res.json({
                success: true,
                status: 'diagnosed',
                message: 'Payment verified from transaction records.'
            });
        }

        // 2. CRITICAL FALLBACK: Check Stripe API directly
        const stripe = getStripe();
        if (stripe) {
            logger.info(`� No record found in DB. Querying Stripe API directly for jobId: ${jobId}`);

            let sessions = [];
            if (session_id && session_id !== 'null' && session_id !== 'undefined') {
                try {
                    const session = await stripe.checkout.sessions.retrieve(session_id);
                    if (session) sessions = [session];
                } catch (err) {
                    logger.warn(`Failed to retrieve session ${session_id}: ${err.message}`);
                }
            }

            if (sessions.length === 0) {
                // List recent sessions and search metadata locally
                const result = await stripe.checkout.sessions.list({ limit: 15 });
                sessions = result.data.filter(s => s.metadata && s.metadata.jobId === jobId);
            }

            for (const s of sessions) {
                if (s.payment_status === 'paid') {
                    logger.info(`💎 Found PAID Stripe session ${s.id} for job ${jobId}. Manually finalizing...`);
                    const amount = Number(s.metadata.amount);
                    await JobService.handleJobPaymentSuccess(jobId, amount, 'stripe', s.id);

                    return res.json({
                        success: true,
                        status: 'diagnosed',
                        message: 'Payment verified directly via Stripe API.'
                    });
                }
            }
        }

        // If still no payment found anywhere
        res.json({
            success: false,
            status: job.status,
            message: 'Payment processing in progress. If you already paid, please wait 30s.'
        });
    } catch (e) {
        logger.error(`❌ verifyJobPayment Error: ${e.message}`);
        next(e);
    }
};

/**
 * STRIPE: Init Onboarding for Worker
 */
exports.onboardWorker = async (req, res, next) => {
    try {
        const protocol = req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}/api/payments`;

        const url = await PaymentService.createStripeOnboardingLink(req.user.id, baseUrl);
        
        res.status(200).json({
            success: true,
            url
        });
    } catch (e) {
        next(e);
    }
};

/**
 * Handle Onboarding Success
 */
exports.stripeOnboardingSuccess = async (req, res) => {
    const { workerId } = req.query;
    
    // Update worker status if possible (better to use webhooks but this is a fallback)
    const worker = await Worker.findOne({ user: workerId });
    if (worker) {
        worker.stripeOnboarded = true;
        await worker.save();
    }

    res.send(`
        <html>
            <head>
                <title>Success</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f7f6; }
                    .card { background: white; padding: 2rem; border-radius: 12px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    .btn { background: #008080; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Stripe Connected!</h1>
                    <p>Your bank account has been linked successfully.</p>
                    <a href="skillbridge://stripe/onboarding/success" class="btn">Return to App</a>
                </div>
            </body>
        </html>
    `);
};

/**
 * Handle Onboarding Refresh
 */
exports.stripeOnboardingRefresh = async (req, res) => {
    res.send(`
        <html>
            <body>
                <h1>Session Expired</h1>
                <p>Please try again from the app.</p>
                <a href="skillbridge://stripe/onboarding/refresh">Return to App</a>
            </body>
        </html>
    `);
};

/**
 * STRIPE: Get Login Link for Worker Dashboard
 */
exports.getWorkerLoginLink = async (req, res, next) => {
    try {
        const url = await PaymentService.createStripeLoginLink(req.user.id);
        res.status(200).json({
            success: true,
            url
        });
    } catch (e) {
        next(e);
    }
};
