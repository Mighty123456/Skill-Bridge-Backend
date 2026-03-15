const Payment = require('./payment.model');
const Wallet = require('../wallet/wallet.model');
const WalletService = require('../wallet/wallet.service');
const Job = require('../jobs/job.model');
const Worker = require('../workers/worker.model');
const User = require('../users/user.model');
const config = require('../../config/env');
const getStripe = () => {
    const stripeKey = config.STRIPE_SECRET_KEY;
    if (!stripeKey) return null;
    return require('stripe')(stripeKey);
};
const mongoose = require('mongoose');
const crypto = require('crypto');

const notifyHelper = require('../../common/notification.helper');
const logger = require('../../config/logger');

// Constants
const PROTECTION_FEE = 29;
const COMMISSION_RATE = 0.15; // 15%

/**
 * Immutable Ledger: Sign and Hash Transaction
 */
const signPayment = async (payment, session = null) => {
    // 1. Find the last hash in the ledger
    const lastPayment = await Payment.findOne().sort({ createdAt: -1 }).session(session);
    const previousHash = lastPayment ? lastPayment.currentHash : '0';

    // 2. Prepare data for hashing (Deterministic)
    const dataToHash = [
        previousHash,
        payment.transactionId,
        payment.user.toString(),
        payment.amount.toString(),
        payment.type,
        payment.status
    ].join('|');

    // 3. Generate SHA-256 Hash
    const currentHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    // 4. Update payment object
    payment.previousHash = previousHash;
    payment.currentHash = currentHash;

    return payment;
};

/**
 * Calculate Breakdown
 */
/**
 * Calculate Breakdown (Async)
 * Checks worker subscription for commission rate
 */
exports.calculateBreakdown = async (jobAmount, workerId) => {
    let commissionRate = COMMISSION_RATE; // Default 15%
    const GST_RATE = 0.18; // 18% Professional GST standard

    if (workerId) {
        const worker = await Worker.findOne({ user: workerId });
        if (worker && worker.subscription && worker.subscription.plan) {
            const plan = worker.subscription.plan;
            if (plan === 'gold') commissionRate = 0.10; // 10%
            if (plan === 'platinum') commissionRate = 0.05; // 5%
        }
    }

    // 1. Protection Fee Calculation (Tenant Side)
    const baseProtectionFee = PROTECTION_FEE;
    const protectionGST = Math.round(baseProtectionFee * GST_RATE);
    const totalProtection = baseProtectionFee + protectionGST;

    // 2. Platform Commission Calculation (Worker Side)
    const baseCommission = Math.round(jobAmount * commissionRate);
    const commissionGST = Math.round(baseCommission * GST_RATE);
    const totalCommissionDeduction = baseCommission + commissionGST;

    // 3. Split GST for transparency (9% CGST + 9% SGST)
    const protectionCGST = Number((protectionGST / 2).toFixed(2));
    const protectionSGST = Number((protectionGST / 2).toFixed(2));
    const commissionCGST = Number((commissionGST / 2).toFixed(2));
    const commissionSGST = Number((commissionGST / 2).toFixed(2));

    // 4. Final Totals
    const workerAmount = Math.max(0, jobAmount - totalCommissionDeduction);
    const totalUserPayable = jobAmount + totalProtection;
    const platformRevenue = baseCommission + baseProtectionFee;
    const totalGST = protectionGST + commissionGST;

    return {
        jobAmount,
        protectionFee: baseProtectionFee,
        protectionTax: protectionGST,
        protectionCGST,
        protectionSGST,
        commission: baseCommission,
        commissionTax: commissionGST,
        commissionCGST,
        commissionSGST,
        workerAmount,
        totalUserPayable,
        platformRevenue,
        totalGST,
        gstRate: GST_RATE,
        rateApplied: commissionRate
    };
};

/**
 * Create Escrow Payment (Direct Pay — No Tenant Wallet)
 * Records the escrow after Stripe/external payment has been collected.
 * Tenant pays directly via Stripe — no wallet balance involved.
 */
exports.createEscrow = async (jobId, userId, jobAmount, gateway = 'stripe', gatewayId = null, session = null) => {
    const ownSession = !session;
    if (ownSession) {
        session = await mongoose.startSession();
        session.startTransaction();
    }

    try {
        const job = await Job.findById(jobId).session(session);
        if (!job) throw new Error('Job not found for escrow');

        // EDGE CASE: Prevent duplicate escrow for same job
        const existingEscrow = await Payment.findOne({
            job: jobId, type: 'escrow', status: 'completed'
        }).session(session);
        if (existingEscrow) {
            logger.warn(`Duplicate escrow attempt blocked for job ${jobId}. Existing TXN: ${existingEscrow.transactionId}`);
            if (ownSession) await session.commitTransaction();
            return existingEscrow;
        }

        // EDGE CASE: Validate amount bounds
        if (!jobAmount || isNaN(jobAmount) || jobAmount <= 0) {
            throw new Error(`Invalid job amount: ${jobAmount}. Amount must be a positive number.`);
        }
        if (jobAmount > 500000) {
            throw new Error(`Job amount \u20b9${jobAmount} exceeds maximum allowed (\u20b9500,000). Contact support.`);
        }

        const breakdown = await exports.calculateBreakdown(jobAmount, job.selected_worker_id);
        const totalAmount = breakdown.totalUserPayable;

        // Create Payment Record (Escrow) — money is held by Stripe/platform, not tenant wallet
        const payment = new Payment({
            job: jobId,
            user: userId,
            amount: totalAmount,
            type: 'escrow',
            status: 'completed',
            transactionId: gatewayId || `TXN_ESCROW_${Date.now()}_${jobId}`,
            currency: 'INR',
            paymentMethod: gateway,
            gatewayResponse: { breakdown, gateway, isDirectPay: true }
        });

        await signPayment(payment, session);
        await payment.save({ session });

        // Send Multi-Channel Notification
        try {
            const tenant = await User.findById(userId).session(session);
            const worker = await User.findById(job.selected_worker_id).session(session);
            if (tenant && worker) {
                await notifyHelper.onPaymentEscrowed(tenant, worker, job, {
                    totalAmount,
                    jobAmount: jobAmount,
                    protectionFee: breakdown.protectionFee
                });
            }
        } catch (notifyErr) {
            logger.error(`Escrow notification failed: ${notifyErr.message}`);
        }

        if (ownSession) {
            await session.commitTransaction();
        }
        return payment;
    } catch (error) {
        if (ownSession) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (ownSession) {
            session.endSession();
        }
    }
};

/**
 * Record External Escrow (Stripe/External Pay)
 * This doesn't touch internal wallet balance, but records the escrow in our DB
 */
exports.recordExternalEscrow = async (jobId, userId, totalAmount, gateway, gatewayId, session = null, paymentIntentId = null) => {
    const Payment = require('./payment.model');
    const Job = require('../jobs/job.model');

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new Error('Job not found for external escrow');

    const breakdown = await exports.calculateBreakdown(job.diagnosis_report.final_total_cost, job.selected_worker_id);

    const payment = new Payment({
        job: jobId,
        user: userId,
        amount: totalAmount,
        type: 'escrow',
        status: 'completed',
        transactionId: gatewayId || `TXN_EXT_${Date.now()}_${jobId}`,
        currency: 'INR',
        paymentMethod: gateway,
        gatewayResponse: { breakdown, isExternal: true, gateway, paymentIntentId }
    });

    await signPayment(payment, session);
    await payment.save({ session });

    // Send Multi-Channel Notification
    try {
        const tenant = await User.findById(userId).session(session);
        const worker = await User.findById(job.selected_worker_id).session(session);
        if (tenant && worker) {
            await notifyHelper.onPaymentEscrowed(tenant, worker, job, {
                totalAmount,
                jobAmount: totalAmount - breakdown.protectionFee,
                protectionFee: breakdown.protectionFee
            });
        }
    } catch (notifyErr) {
        logger.error(`External escrow notification failed: ${notifyErr.message}`);
    }

    return payment;
};

/**
 * Create Material Escrow (100% to Worker, No Commission assumed for now)
 */
/**
 * Create Material Escrow (Direct Pay — No Tenant Wallet)
 * Records the material escrow after Stripe payment collected.
 */
exports.createMaterialEscrow = async (jobId, userId, amount, gateway = 'stripe', gatewayId = null, session = null, paymentIntentId = null) => {
    const ownSession = !session;
    if (ownSession) {
        session = await mongoose.startSession();
        session.startTransaction();
    }

    try {
        const payment = new Payment({
            job: jobId,
            user: userId,
            amount: amount,
            type: 'escrow',
            status: 'completed',
            transactionId: gatewayId || `TXN_MAT_ESCROW_${Date.now()}_${jobId}`,
            currency: 'INR',
            paymentMethod: gateway,
            gatewayResponse: { isMaterial: true, gateway, isDirectPay: true, paymentIntentId }
        });

        await signPayment(payment, session);
        await payment.save({ session });

        if (ownSession) {
            await session.commitTransaction();
        }
        return payment;
    } catch (error) {
        if (ownSession) {
            await session.abortTransaction();
        }
        throw error;
    } finally {
        if (ownSession) {
            session.endSession();
        }
    }
};

/**
 * Create Stripe Checkout Session for Material Payment
 */
exports.createMaterialCheckoutSession = async (jobId, userId, materialAmount, requestId, backEndUrl = null) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured.');

    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    const baseReturnUrl = backEndUrl || `${config.RENDER_BACKEND_URL}/api/payments`;

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
            price_data: {
                currency: 'inr',
                product_data: {
                    name: `Material: ${job.job_title}`,
                    description: `Additional material cost for your job.`,
                },
                unit_amount: Math.round(materialAmount * 100),
            },
            quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseReturnUrl}/success?jobId=${jobId}&type=material_payment&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseReturnUrl}/cancel?jobId=${jobId}&type=material_payment`,
        customer_email: (await mongoose.model('User').findById(userId))?.email,
        metadata: {
            userId: userId.toString(),
            jobId: jobId.toString(),
            amount: materialAmount.toString(),
            requestId: requestId?.toString() || '',
            type: 'material_payment'
        }
    });

    return session;
};

/**
 * Release Job Payment
 * Moves funds from User Escrow -> Worker Balance + Platform Revenue
 */
exports.releasePayment = async (jobId) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const job = await Job.findById(jobId).session(session);
        if (!job) throw new Error('Job not found');
        if (job.payment_released) throw new Error('Payment already released');

        // 2. Find ALL Escrow Payments
        const escrowPayments = await Payment.find({
            job: jobId,
            type: 'escrow',
            status: 'completed'
        }).session(session);

        if (escrowPayments.length === 0) {
            throw new Error('No escrow payments found for this job');
        }

        let totalWorkerPayout = 0;
        let totalPlatformRevenue = 0;
        let totalLocked = 0;

        for (const payment of escrowPayments) {
            totalLocked += payment.amount;

            // Check metadata to see if it's material or labor
            if (payment.gatewayResponse && payment.gatewayResponse.isMaterial) {
                // Material: 100% to worker
                totalWorkerPayout += payment.amount;
            } else if (payment.gatewayResponse && payment.gatewayResponse.breakdown) {
                // Labor: Use stored breakdown
                const bd = payment.gatewayResponse.breakdown;
                totalWorkerPayout += bd.workerAmount;
                totalPlatformRevenue += bd.platformRevenue;
            } else {
                // Fallback (Shouldn't happen if structure preserved)
                // Assume it's labor? Or safe 100% worker? 
                // Let's assume 100% worker to avoid stealing.
                totalWorkerPayout += payment.amount;
            }

            // Mark escrow as released/closed?
            // Actually we leave them as 'completed' but maybe add a flag 'released'?
            // Payment model doesn't have 'released' status. 
            // We'll rely on Job.payment_released flag to prevent double pay.
        }

        // 3. Escrow is a DB record (Payment model), NOT tenant wallet balance.
        // No tenant wallet to debit — money was collected via Stripe directly.
        // Mark escrow payments as released.
        for (const ep of escrowPayments) {
            ep.status = 'released';
            await ep.save({ session });
        }

        // 4. Credit Worker Wallet (With Delay Logic & Warranty Reserve)
        const worker = await Worker.findOne({ user: job.selected_worker_id }).session(session);
        const isNewWorker = !worker || (worker.totalJobsCompleted || 0) < 5;

        // Increment Worker Stats
        if (worker) {
            worker.totalJobsCompleted = (worker.totalJobsCompleted || 0) + 1;
            // Also boost reliability score slightly for successful completion
            worker.reliabilityScore = Math.min(100, (worker.reliabilityScore || 60) + 1);
            await worker.save({ session });
        }

        let warrantyReserve = 0;
        if (job.diagnosis_report && job.diagnosis_report.warranty_offered && job.diagnosis_report.warranty_duration_days > 0) {
            // Reserve 5% of the total labor payout. For simplicity, we assume totalWorkerPayout captures labor mostly here.
            warrantyReserve = Math.round(totalWorkerPayout * 0.05);
            job.warranty_reserve_locked = warrantyReserve;
            await job.save({ session });
        }

        const payoutToWallet = totalWorkerPayout - warrantyReserve;
        const warrantyExpiryDate = new Date(Date.now() + (job.diagnosis_report?.warranty_duration_days || 0) * 24 * 60 * 60 * 1000);

        const workerWallet = await Wallet.findOne({ user: job.selected_worker_id }).session(session);
        if (!workerWallet) {
            // ... (Wallet creation logic remains)
            const initialWallet = {
                user: job.selected_worker_id,
                balance: isNewWorker ? 0 : payoutToWallet,
                pendingBalance: isNewWorker ? payoutToWallet : 0,
                pendingPayouts: isNewWorker ? [{
                    amount: payoutToWallet,
                    releaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 Hour Delay
                    jobId: jobId
                }] : [],
                warrantyReserveBalance: warrantyReserve,
                activeWarranties: warrantyReserve > 0 ? [{
                    amount: warrantyReserve,
                    releaseAt: warrantyExpiryDate,
                    jobId: jobId
                }] : []
            };
            await Wallet.create([initialWallet], { session });
        } else {
            if (warrantyReserve > 0) {
                workerWallet.warrantyReserveBalance = (workerWallet.warrantyReserveBalance || 0) + warrantyReserve;
                if (!workerWallet.activeWarranties) workerWallet.activeWarranties = [];
                workerWallet.activeWarranties.push({
                    amount: warrantyReserve,
                    releaseAt: warrantyExpiryDate,
                    jobId: jobId
                });
            }

            if (isNewWorker) {
                workerWallet.pendingBalance = (workerWallet.pendingBalance || 0) + payoutToWallet;
                if (!workerWallet.pendingPayouts) workerWallet.pendingPayouts = [];
                workerWallet.pendingPayouts.push({
                    amount: payoutToWallet,
                    releaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
                    jobId: jobId
                });
            } else {
                // AUTO-PAYOUT LOGIC (Stripe Connect)
                // If worker is NOT new and has a Stripe account, attempt automated transfer
                const stripeResult = await exports.processStripeTransfer(job.selected_worker_id, payoutToWallet, jobId);

                if (stripeResult.success) {
                    workerWallet.balance = (workerWallet.balance || 0) + payoutToWallet;
                    // We still record it in our wallet for ledger consistency, 
                    // but we might want to mark it as withdrawn/processed externally.
                    // For now, increasing balance is fine as the worker can see it as "paid".
                    const { appendTimeline } = require('../jobs/job.service');
                    appendTimeline(job, 'completed', 'system', `Automated payout via Stripe Connect successful. Transfer ID: ${stripeResult.transferId}`);
                } else {
                    workerWallet.balance += payoutToWallet;
                    logger.info(`Manual payout required for Job ${jobId}. Reason: ${stripeResult.message}`);
                }
            }
            await workerWallet.save({ session });
        }

        if (isNewWorker) {
            const { appendTimeline } = require('../jobs/job.service');
            appendTimeline(job, 'completed', 'system', 'Worker is new (< 5 jobs). Payout scheduled with 72-hour fraud prevention delay.');
        }

        // 5. Credit Platform Wallet (Revenue)
        if (totalPlatformRevenue > 0) {
            await WalletService.creditPlatformRevenue(totalPlatformRevenue, session);
        }
        const payout = new Payment({
            job: jobId,
            user: job.user_id,
            worker: job.selected_worker_id,
            amount: totalWorkerPayout,
            type: 'payout',
            status: 'completed',
            transactionId: `TXN_PAYOUT_${Date.now()}_${jobId}`,
            currency: config.DEFAULT_CURRENCY || 'INR',
            gatewayResponse: { revenue: totalPlatformRevenue }
        });
        await signPayment(payout, session);
        await payout.save({ session });

        // 7. Create Commission Record
        if (totalPlatformRevenue > 0) {
            const commissionRecord = new Payment({
                job: jobId,
                user: job.user_id,
                amount: totalPlatformRevenue,
                type: 'commission',
                status: 'completed',
                transactionId: `TXN_COMM_${Date.now()}_${jobId}`,
                currency: config.DEFAULT_CURRENCY || 'INR'
            });
            await signPayment(commissionRecord, session);
            await commissionRecord.save({ session });
        }

        // Send Multi-Channel Notifications
        try {
            const tenant = await User.findById(job.user_id).session(session);
            const workerUser = await User.findById(job.selected_worker_id).session(session);
            if (workerUser) {
                await notifyHelper.onPaymentReleased(workerUser, job, {
                    netPayout: totalWorkerPayout
                });
            }
            if (tenant) {
                // Custom push for tenant notifying completion
                const tTitle = 'Job Finalized';
                const tBody = `Payment has been released to the worker for job "${job.job_title}".`;
                // Simple DB notification for tenant
                await notifyHelper.onJobStatusUpdate(
                    job.user_id,
                    tTitle,
                    tBody,
                    { jobId, type: 'release' }
                );
            }
        } catch (notifyErr) {
            logger.error(`Release notification failed: ${notifyErr.message}`);
        }

        job.payment_released = true;
        await job.save({ session });

        await session.commitTransaction();
        return payout;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Refund Payment (Full Refund to User)
 */
/**
 * Refund Payment (Direct Pay — issues Stripe refund, no tenant wallet)
 * Refunds via Stripe back to the tenant's original payment method.
 */
exports.refundPayment = async (jobId) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const escrowPayments = await Payment.find({
            job: jobId,
            type: 'escrow',
            status: 'completed'
        }).session(session);

        if (escrowPayments.length === 0) {
            // EDGE CASE: Check if already refunded (idempotency)
            const existingRefund = await Payment.findOne({
                job: jobId, type: 'refund'
            }).session(session);
            if (existingRefund) {
                logger.warn(`Refund already processed for job ${jobId}. TXN: ${existingRefund.transactionId}`);
                await session.abortTransaction();
                return existingRefund;
            }
            // EDGE CASE: Check if payment was already released (cannot refund)
            const releasedPayments = await Payment.findOne({
                job: jobId, type: 'escrow', status: 'released'
            }).session(session);
            if (releasedPayments) {
                throw new Error('Payment already released to worker. Cannot refund a released payment. Use settlement instead.');
            }
            throw new Error('Escrow record not found');
        }

        let totalRefund = 0;

        // Issue Stripe refunds for each escrow payment
        const stripe = getStripe();
        for (const payment of escrowPayments) {
            totalRefund += payment.amount;
            payment.status = 'refunded';

            // Attempt Stripe refund if paid via Stripe
            if (stripe && payment.gatewayResponse?.gateway === 'stripe') {
                try {
                    const paymentIntentId = payment.gatewayResponse?.paymentIntentId;
                    if (paymentIntentId) {
                        await stripe.refunds.create({
                            payment_intent: paymentIntentId,
                            amount: Math.round(payment.amount * 100), // cents
                        });
                        logger.info(`Stripe refund issued for payment ${payment._id}`);
                    }
                } catch (stripeErr) {
                    logger.error(`Stripe refund failed for payment ${payment._id}: ${stripeErr.message}`);
                    // Continue — record refund in our DB even if Stripe call fails (admin can handle manually)
                }
            }

            await payment.save({ session });
        }

        // Create Refund Record in our ledger
        const refund = new Payment({
            job: jobId,
            user: escrowPayments[0].user,
            amount: totalRefund,
            type: 'refund',
            status: 'refunded',
            transactionId: `TXN_REFUND_${Date.now()}_${jobId}`,
            currency: config.DEFAULT_CURRENCY || 'INR'
        });
        await signPayment(refund, session);
        await refund.save({ session });

        // Send refund email notification (async)
        const EmailService = require('../../common/services/email.service');
        const job = await Job.findById(jobId).populate('user_id', 'name email').lean();
        if (job && job.user_id && job.user_id.email) {
            EmailService.sendRefundEmail(job.user_id.email, {
                userName: job.user_id.name,
                jobTitle: job.job_title,
                refundAmount: totalRefund,
                reason: 'Job cancelled — refund issued to original payment method'
            }).catch(err => logger.error(`Failed to send refund email: ${err.message}`));
        }

        // Send Multi-Channel Notification
        try {
            const tenant = await User.findById(escrowPayments[0].user).session(session);
            if (tenant) {
                await notifyHelper.onRefundProcessed(tenant, job, totalRefund);
            }
        } catch (notifyErr) {
            logger.error(`Refund notification failed: ${notifyErr.message}`);
        }

        await session.commitTransaction();
        return refund;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Process Settlement (Split escrow between tenant and worker)
 * Used for dispute resolution or mutual cancellations with partial pay
 */
exports.processSettlement = async (jobId, workerAmount, tenantAmount, adminId, notes) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const job = await Job.findById(jobId).session(session);
        if (!job) throw new Error('Job not found');

        // 1. Verify Escrow Balance
        const escrowPayments = await Payment.find({
            job: jobId,
            type: 'escrow',
            status: 'completed'
        }).session(session);

        const totalEscrowed = escrowPayments.reduce((sum, p) => sum + p.amount, 0);

        // EDGE CASE: Validate settlement amounts
        if (workerAmount < 0 || tenantAmount < 0) {
            throw new Error('Settlement amounts cannot be negative');
        }
        if (isNaN(workerAmount) || isNaN(tenantAmount)) {
            throw new Error('Settlement amounts must be valid numbers');
        }
        if (workerAmount + tenantAmount > totalEscrowed + 0.01) {
            throw new Error(`Total settlement (\u20b9${(workerAmount + tenantAmount).toFixed(2)}) exceeds escrowed funds (\u20b9${totalEscrowed.toFixed(2)})`);
        }

        // 2. Adjust Status of Escrow Records
        for (const p of escrowPayments) {
            p.status = 'refunded';
            await p.save({ session });
        }

        // 3. Refund Tenant portion via Stripe (no tenant wallet)
        if (tenantAmount > 0) {
            // Attempt Stripe refund
            const stripe = getStripe();
            if (stripe) {
                for (const ep of escrowPayments) {
                    if (ep.gatewayResponse?.gateway === 'stripe') {
                        try {
                            const paymentIntentId = ep.gatewayResponse?.paymentIntentId;
                            if (paymentIntentId) {
                                await stripe.refunds.create({
                                    payment_intent: paymentIntentId,
                                    amount: Math.round(tenantAmount * 100),
                                });
                                logger.info(`Stripe settlement refund of \u20b9${tenantAmount} for job ${jobId}`);
                                break; // Only need to refund once
                            }
                        } catch (stripeErr) {
                            logger.error(`Stripe settlement refund failed: ${stripeErr.message}`);
                        }
                    }
                }
            }

            const refundRecord = new Payment({
                job: jobId,
                user: job.user_id,
                amount: tenantAmount,
                type: 'refund',
                status: 'completed',
                transactionId: `TXN_SETTLE_REFUND_${Date.now()}_${jobId}`,
                gatewayResponse: { adminId, settlementType: 'partial' }
            });
            await signPayment(refundRecord, session);
            await refundRecord.save({ session });
        }

        // 4. Pay Worker portion
        if (workerAmount > 0) {
            // Credit worker wallet
            const workerWallet = await Wallet.findOne({ user: job.selected_worker_id }).session(session);
            if (!workerWallet) {
                await WalletService.creditWallet(job.selected_worker_id, workerAmount, session);
            } else {
                // Check for automated payout (Stripe Connect)
                const stripeResult = await exports.processStripeTransfer(job.selected_worker_id, workerAmount, jobId);
                
                if (stripeResult.success) {
                    workerWallet.balance += workerAmount;
                    appendTimeline(job, 'completed', 'system', `Settlement payout via Stripe Connect successful. Transfer ID: ${stripeResult.transferId}`);
                } else {
                    workerWallet.balance += workerAmount;
                    logger.info(`Manual settlement payout required for Job ${jobId}. Reason: ${stripeResult.message}`);
                }
                await workerWallet.save({ session });
            }

            const payoutRecord = new Payment({
                job: jobId,
                user: job.user_id,
                worker: job.selected_worker_id,
                amount: workerAmount,
                type: 'payout',
                status: 'completed',
                transactionId: `TXN_SETTLE_PAYOUT_${Date.now()}_${jobId}`,
                gatewayResponse: { adminId, settlementType: 'partial' }
            });
            await signPayment(payoutRecord, session);
            await payoutRecord.save({ session });
        }

        // 5. Update Job Status
        job.status = 'completed'; // Changed from 'resolved' to standard status
        if (job.dispute && job.dispute.is_disputed) {
            job.dispute.status = 'resolved';
            job.dispute.resolved_at = new Date();
            job.dispute.decision = 'partial_refund';
            job.dispute.resolution_note = notes;
        }
        
        job.timeline.push({
            status: 'completed',
            note: `Settlement processed by admin. Worker paid ₹${workerAmount}, Tenant refunded ₹${tenantAmount}.${notes ? ' Note: ' + notes : ''}`,
            timestamp: new Date()
        });
        await job.save({ session });

        // 6. Multi-Channel Notifications (FCM, In-App)
        try {
            const tenant = await User.findById(job.user_id).session(session);
            const workerUser = await User.findById(job.selected_worker_id).session(session);
            if (tenant && workerUser) {
                await notifyHelper.onSettlementProcessed(tenant, workerUser, job, tenantAmount, workerAmount);
            }
        } catch (notifyErr) {
            logger.error(`Settlement notification failed: ${notifyErr.message}`);
        }

        await session.commitTransaction();
        return { success: true, workerAmount, tenantAmount };

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * ADMIN: Get Platform Stats
 */
exports.getPlatformStats = async () => {
    const stats = await Payment.aggregate([
        {
            $match: {
                type: 'commission',
                status: 'completed'
            }
        },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: '$amount' },
                transactionCount: { $sum: 1 },
                latestRevenue: { $max: '$createdAt' }
            }
        }
    ]);

    return stats[0] || { totalRevenue: 0, transactionCount: 0 };
};

/**
 * STRIPE: Create Checkout Session for Wallet Top-up
 */
exports.createStripeCheckoutSession = async (userId, amount, backEndUrl = null) => {
    // 1. Convert amount to cents for Stripe
    const amountInCents = Math.round(amount * 100);

    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');

    // Determine Success/Cancel URLs
    // Preference: 1. Passed backEndUrl (from request), 2. Generic Backend URL from config, 3. Frontend URL fallback
    const baseReturnUrl = backEndUrl || `${config.RENDER_BACKEND_URL}/api/payments` || `${config.FRONTEND_URL}/wallet`;

    // 2. Create Checkout Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: (config.DEFAULT_CURRENCY || 'INR').toLowerCase(),
                    product_data: {
                        name: 'SkillBridge Wallet Top-up',
                        description: `Add ${config.DEFAULT_CURRENCY || 'INR'} ${amount} to your professional wallet.`,
                    },
                    unit_amount: amountInCents,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${baseReturnUrl}/success?type=wallet_topup&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseReturnUrl}/cancel?type=wallet_topup`,
        customer_email: (await mongoose.model('User').findById(userId)).email,
        metadata: {
            userId: userId.toString(),
            amount: amount.toString(),
            type: 'wallet_topup'
        }
    });

    return session;
};

/**
 * STRIPE: Create Checkout Session for specific Job (Direct Pay)
 */
exports.createJobCheckoutSession = async (jobId, userId, backEndUrl = null) => {
    const job = await Job.findById(jobId).populate('selected_worker_id');
    if (!job) throw new Error('Job not found');

    const amount = job.diagnosis_report.final_total_cost;
    const breakdown = await exports.calculateBreakdown(amount, job.selected_worker_id);

    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY.');

    // Determine Success/Cancel URLs
    const baseReturnUrl = backEndUrl || `${config.RENDER_BACKEND_URL}/api/payments` || `${config.FRONTEND_URL}/payment`;

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: (config.DEFAULT_CURRENCY || 'INR').toLowerCase(),
                    product_data: {
                        name: `Job Approval: ${job.job_title}`,
                        description: `Payment for labor and platform protection fee.`,
                    },
                    unit_amount: Math.round(breakdown.totalUserPayable * 100),
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${baseReturnUrl}/success?jobId=${jobId}&type=job_payment&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseReturnUrl}/cancel?jobId=${jobId}&type=job_payment`,
        customer_email: (await mongoose.model('User').findById(userId)).email,
        metadata: {
            userId: userId.toString(),
            jobId: jobId.toString(),
            amount: breakdown.totalUserPayable.toString(),
            type: 'job_payment'
        }
    });

    return session;
};

/**
 * ADMIN: Verify Ledger Integrity
 */
exports.verifyLedger = async () => {
    const payments = await Payment.find().sort({ createdAt: 1 });
    const report = {
        totalRecords: payments.length,
        verified: 0,
        tampered: 0,
        errors: []
    };

    let runningHash = '0';

    for (const p of payments) {
        const dataToHash = [
            p.previousHash,
            p.transactionId,
            p.user.toString(),
            p.amount.toString(),
            p.type,
            p.status
        ].join('|');

        const expectedHash = crypto.createHash('sha256').update(dataToHash).digest('hex');

        if (p.currentHash !== expectedHash) {
            report.tampered++;
            report.errors.push(`Tampered Record ID: ${p._id} (Stored: ${p.currentHash ? p.currentHash.slice(0, 8) : 'MISSING'}..., Expected: ${expectedHash.slice(0, 8)}...)`);
        } else if (p.previousHash !== runningHash) {
            report.tampered++;
            report.errors.push(`Broken Chain at ID: ${p._id} (Points to: ${p.previousHash ? p.previousHash.slice(0, 8) : '0'}..., Last Hash: ${runningHash.slice(0, 8)}...)`);
        } else {
            report.verified++;
        }
        runningHash = p.currentHash || '0';
    }

    return report;
};

/**
 * Handle Refund initiated from External Gateway (Stripe Dashboard)
 */
exports.handleExternalRefund = async (chargeId, amount, session) => {
    const notifyHelper = require('../../common/notification.helper');
    const Wallet = require('../wallet/wallet.model');

    // Find the original payment record
    // We check transactionId (Session ID) and also common Stripe IDs in gatewayResponse
    const originalPayment = await Payment.findOne({
        $or: [
            { transactionId: chargeId },
            { 'gatewayResponse.stripeSessionId': chargeId },
            { 'gatewayResponse.paymentIntentId': chargeId },
            { 'gatewayResponse.chargeId': chargeId }
        ]
    }).session(session);

    if (!originalPayment) {
        logger.warn(`External refund received for unknown transaction: ${chargeId}`);
        return;
    }

    if (originalPayment.status === 'refunded') return;

    originalPayment.status = 'refunded';
    await originalPayment.save({ session });

    // Deduct from wallet if it was a top-up
    if (originalPayment.type === 'topup') {
        const wallet = await Wallet.findOne({ user: originalPayment.user }).session(session);
        if (wallet) {
            wallet.balance = Math.max(0, wallet.balance - amount);
            await wallet.save({ session });

            await notifyHelper.onWalletTransaction(
                originalPayment.user,
                'Payment Refunded',
                `₹${amount.toFixed(2)} has been refunded to your original payment method and deducted from your wallet.`,
                { type: 'external_refund' }
            );
        }
    } else if (originalPayment.type === 'escrow') {
        // Escrow is just a DB record now — mark it as refunded, no tenant wallet to update
        originalPayment.status = 'refunded';
        await originalPayment.save({ session });
    }

    logger.info(`Processed external refund for payment ${originalPayment._id}. Amount: ₹${amount}`);
};

/**
 * Stripe Connect: Automated Transfer to Worker
 * Triggered when a job is finalized and the worker has a connected account.
 */
exports.processStripeTransfer = async (workerId, amount, jobId) => {
    const stripe = getStripe();
    if (!stripe) return { success: false, message: 'Stripe not configured' };

    // EDGE CASE: Validate transfer amount
    if (!amount || isNaN(amount) || amount <= 0) {
        return { success: false, message: `Invalid transfer amount: ${amount}` };
    }
    if (amount < 1) {
        return { success: false, message: 'Transfer amount too small (minimum ₹1)' };
    }

    try {
        const worker = await Worker.findOne({ user: workerId });
        if (!worker || !worker.stripeAccountId || !worker.stripeOnboarded) {
            logger.info(`Stripe: Worker ${workerId} not ready for automated transfer. Payout kept in internal wallet.`);
            return { success: false, message: 'Worker not onboarded for Stripe Connect' };
        }

        // EDGE CASE: Check if payouts are disabled (auto-disabled after 3 failures)
        if (!worker.payoutEnabled) {
            logger.warn(`Stripe: Worker ${workerId} payouts are disabled. Manual review required.`);
            return { success: false, message: 'Worker payouts disabled due to repeated failures. Admin review required.' };
        }

        // Use idempotency key to prevent duplicate transfers on retries
        const idempotencyKey = `transfer_${workerId}_${jobId}_${Math.round(amount * 100)}`;

        const transfer = await stripe.transfers.create({
            amount: Math.round(amount * 100), // In cents
            currency: (config.DEFAULT_CURRENCY || 'INR').toLowerCase(),
            destination: worker.stripeAccountId,
            description: `Payout for Job ID: ${jobId}`,
            metadata: { jobId: jobId.toString(), workerId: workerId.toString() }
        }, {
            idempotencyKey
        });

        // Track success — reset failure counters
        worker.lastPayoutAt = new Date();
        worker.lastPayoutError = null;
        worker.consecutivePayoutFailures = 0;
        await worker.save();

        logger.info(`Stripe: Automated transfer successful for Job ${jobId}. Transfer ID: ${transfer.id}`);
        return { success: true, transferId: transfer.id };
    } catch (error) {
        logger.error(`Stripe Transfer Failed for worker ${workerId}: ${error.message}`);
        
        // Track failure on worker profile with retry metadata
        try {
            const failedWorker = await Worker.findOne({ user: workerId });
            if (failedWorker) {
                failedWorker.lastPayoutError = error.message;
                failedWorker.consecutivePayoutFailures = (failedWorker.consecutivePayoutFailures || 0) + 1;
                failedWorker.lastPayoutFailedAt = new Date();

                // EDGE CASE: Auto-disable payouts after 3 consecutive failures
                if (failedWorker.consecutivePayoutFailures >= 3) {
                    failedWorker.payoutEnabled = false;
                    logger.warn(`Stripe: Auto-disabled payouts for worker ${workerId} after ${failedWorker.consecutivePayoutFailures} consecutive failures. Manual review required.`);
                }
                await failedWorker.save();
            }
        } catch (dbErr) {
            logger.error(`Failed to update worker payout error: ${dbErr.message}`);
        }

        return { success: false, message: error.message };
    }
};

/**
 * Create Stripe Onboarding Link for Worker
 */
exports.createStripeOnboardingLink = async (workerId, baseUrl) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe not configured');

    const worker = await Worker.findOne({ user: workerId });
    if (!worker) throw new Error('Worker profile not found');

    let stripeAccountId = worker.stripeAccountId;

    // 1. Create Account if not exists
    if (!stripeAccountId) {
        const User = require('../users/user.model');
        const user = await User.findById(workerId).lean();
        
        const account = await stripe.accounts.create({
            type: 'express',
            country: 'US', // Changed to US for testing to avoid GST requirements
            email: user.email,
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
            business_type: 'individual',
            metadata: { userId: workerId.toString() }
        });

        stripeAccountId = account.id;
        worker.stripeAccountId = stripeAccountId;
        await worker.save();
        logger.info(`Stripe: Created connected account ${stripeAccountId} for worker ${workerId}`);
    }

    // 2. Create Onboarding Link
    const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${baseUrl}/onboarding-refresh?workerId=${workerId}`,
        return_url: `${baseUrl}/onboarding-success?workerId=${workerId}`,
        type: 'account_onboarding',
    });

    return accountLink.url;
};

/**
 * Create Stripe Login Link for Worker
 * Allows workers to access their Express Dashboard to see payouts/bank info.
 */
exports.createStripeLoginLink = async (workerId) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe not configured');

    const worker = await Worker.findOne({ user: workerId });
    if (!worker || !worker.stripeAccountId) {
        throw new Error('Stripe account not found for this worker');
    }

    const loginLink = await stripe.accounts.createLoginLink(worker.stripeAccountId);
    return loginLink.url;
};

/**
 * STRIPE: Get Payouts for a Connected Account
 */
exports.getStripePayouts = async (userId) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe not configured');

    const worker = await Worker.findOne({ user: userId });
    if (!worker || !worker.stripeAccountId) {
        return [];
    }

    try {
        const payouts = await stripe.payouts.list(
            { limit: 20 },
            { stripeAccount: worker.stripeAccountId }
        );
        return payouts.data;
    } catch (e) {
        logger.error(`Stripe: Failed to fetch payouts for worker ${userId}: ${e.message}`);
        return [];
    }
};

