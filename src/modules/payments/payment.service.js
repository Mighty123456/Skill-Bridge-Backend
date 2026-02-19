const Payment = require('./payment.model');
const Wallet = require('../wallet/wallet.model'); // Direct model access or service
const WalletService = require('../wallet/wallet.service');
const Job = require('../jobs/job.model');
const Worker = require('../workers/worker.model');
const config = require('../../config/env');
const stripe = require('stripe')(config.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const crypto = require('crypto');

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

    if (workerId) {
        const worker = await Worker.findOne({ user: workerId });
        if (worker && worker.subscription && worker.subscription.plan) {
            const plan = worker.subscription.plan;
            if (plan === 'gold') commissionRate = 0.10; // 10%
            if (plan === 'platinum') commissionRate = 0.05; // 5%
        }
    }

    const commission = Math.round(jobAmount * commissionRate);
    const workerAmount = jobAmount - commission;
    const totalUserPayable = jobAmount + PROTECTION_FEE;
    const platformRevenue = commission + PROTECTION_FEE;

    return {
        jobAmount,
        protectionFee: PROTECTION_FEE,
        commission,
        workerAmount,
        totalUserPayable,
        platformRevenue,
        rateApplied: commissionRate
    };
};

/**
 * Create Escrow Payment
 * Locks funds from User's main balance to Escrow Balance
 */
exports.createEscrow = async (jobId, userId, jobAmount) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // Need to find worker ID from job context or pass it?
        // Ideally we pass it. But we only have jobId here.
        // Let's fetch job first? Or assume caller passed valid args?
        // createEscrow is called from JobService.approveDiagnosis(jobId, userId, amount)
        // JobService has the job object there.
        // But to keep signature clean, let's just fetch job here if needed or assume we query it?
        // Actually, we need the job to find the worker.

        const job = await Job.findById(jobId).session(session);
        if (!job) throw new Error('Job not found for escrow');

        const breakdown = await this.calculateBreakdown(jobAmount, job.selected_worker_id);
        const totalAmount = breakdown.totalUserPayable;

        // 1. Check User Wallet Balance
        const userWallet = await Wallet.findOne({ user: userId }).session(session);
        if (!userWallet) {
            throw new Error('User wallet not initialized');
        }

        if (userWallet.balance < totalAmount) {
            throw new Error(`Insufficient funds. Required: ₹${totalAmount}, Available: ₹${userWallet.balance}`);
        }

        // 2. Lock Funds (Move from Balance -> EscrowBalance)
        userWallet.balance -= totalAmount;
        userWallet.escrowBalance += totalAmount;
        await userWallet.save({ session });

        // 3. Create Payment Record (Escrow)
        const payment = new Payment({
            job: jobId,
            user: userId,
            amount: totalAmount,
            type: 'escrow',
            status: 'completed', // Escrow is funded
            transactionId: `TXN_ESCROW_${Date.now()}_${jobId}`,
            currency: 'INR',
            paymentMethod: 'wallet',
            gatewayResponse: { breakdown } // Store breakdown in metadata
        });

        await signPayment(payment, session);
        await payment.save({ session });

        await session.commitTransaction();
        return payment;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Record External Escrow (Stripe/External Pay)
 * This doesn't touch internal wallet balance, but records the escrow in our DB
 */
exports.recordExternalEscrow = async (jobId, userId, totalAmount, gateway, gatewayId, session = null) => {
    const Payment = require('./payment.model');
    const Job = require('../jobs/job.model');

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new Error('Job not found for external escrow');

    const breakdown = await this.calculateBreakdown(job.diagnosis_report.final_total_cost, job.selected_worker_id);

    const payment = new Payment({
        job: jobId,
        user: userId,
        amount: totalAmount,
        type: 'escrow',
        status: 'completed',
        transactionId: gatewayId || `TXN_EXT_${Date.now()}_${jobId}`,
        currency: 'INR',
        paymentMethod: gateway,
        gatewayResponse: { breakdown, isExternal: true }
    });

    await signPayment(payment, session);
    return await payment.save({ session });
};

/**
 * Create Material Escrow (100% to Worker, No Commission assumed for now)
 */
exports.createMaterialEscrow = async (jobId, userId, amount) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userWallet = await Wallet.findOne({ user: userId }).session(session);
        if (!userWallet) throw new Error('User wallet not initialized');

        if (userWallet.balance < amount) {
            throw new Error(`Insufficient funds for material. Required: ₹${amount}, Available: ₹${userWallet.balance}`);
        }

        userWallet.balance -= amount;
        userWallet.escrowBalance += amount;
        await userWallet.save({ session });

        const payment = new Payment({
            job: jobId,
            user: userId,
            amount: amount,
            type: 'escrow',
            status: 'completed',
            transactionId: `TXN_MAT_ESCROW_${Date.now()}_${jobId}`,
            currency: 'INR',
            paymentMethod: 'wallet',
            gatewayResponse: { isMaterial: true }
        });

        await signPayment(payment, session);
        await payment.save({ session });

        await session.commitTransaction();
        return payment;
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
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

        // 3. Debit User Escrow (Bulk)
        const userWallet = await Wallet.findOne({ user: job.user_id }).session(session);
        if (userWallet.escrowBalance < totalLocked) {
            // Inconsistency correction
            //  logger.warn(`User ${job.user_id} escrow balance mismatch. Needed ${totalLocked}, has ${userWallet.escrowBalance}`);
            userWallet.escrowBalance = Math.max(0, userWallet.escrowBalance - totalLocked);
        } else {
            userWallet.escrowBalance -= totalLocked;
        }
        await userWallet.save({ session });

        // 4. Credit Worker Wallet (With Delay Logic)
        const worker = await Worker.findOne({ user: job.selected_worker_id }).session(session);
        const isNewWorker = !worker || (worker.totalJobsCompleted || 0) < 5;

        // Increment Worker Stats
        if (worker) {
            worker.totalJobsCompleted = (worker.totalJobsCompleted || 0) + 1;
            // Also boost reliability score slightly for successful completion
            worker.reliabilityScore = Math.min(100, (worker.reliabilityScore || 60) + 1);
            await worker.save({ session });
        }

        const workerWallet = await Wallet.findOne({ user: job.selected_worker_id }).session(session);
        if (!workerWallet) {
            // ... (Wallet creation logic remains)
            const initialWallet = {
                user: job.selected_worker_id,
                balance: isNewWorker ? 0 : totalWorkerPayout,
                pendingBalance: isNewWorker ? totalWorkerPayout : 0,
                pendingPayouts: isNewWorker ? [{
                    amount: totalWorkerPayout,
                    releaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 Hour Delay
                    jobId: jobId
                }] : []
            };
            await Wallet.create([initialWallet], { session });
        } else {
            if (isNewWorker) {
                workerWallet.pendingBalance += totalWorkerPayout;
                workerWallet.pendingPayouts.push({
                    amount: totalWorkerPayout,
                    releaseAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
                    jobId: jobId
                });
            } else {
                workerWallet.balance += totalWorkerPayout;
            }
            await workerWallet.save({ session });
        }

        if (isNewWorker) {
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
            currency: 'INR',
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
                currency: 'INR'
            });
            await signPayment(commissionRecord, session);
            await commissionRecord.save({ session });
        }

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
exports.refundPayment = async (jobId) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const escrowPayments = await Payment.find({
            job: jobId,
            type: 'escrow',
            status: 'completed'
        }).session(session);

        if (escrowPayments.length === 0) throw new Error('Escrow record not found');

        let totalRefund = 0;

        for (const payment of escrowPayments) {
            totalRefund += payment.amount;

            // Refund Record per escrow or bulk? Bulk is cleaner.
            payment.status = 'refunded';
            await payment.save({ session });
        }

        // 1. Unlock User Funds (Escrow -> Balance)
        const userWallet = await Wallet.findOne({ user: escrowPayments[0].user }).session(session); // Assume same user
        userWallet.escrowBalance -= totalRefund;
        userWallet.balance += totalRefund;
        await userWallet.save({ session });

        // 2. Create Refund Record
        const refund = new Payment({
            job: jobId,
            user: escrowPayments[0].user,
            amount: totalRefund,
            type: 'refund',
            status: 'refunded',
            transactionId: `TXN_REFUND_${Date.now()}_${jobId}`,
            currency: 'INR'
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
                reason: 'Job cancelled'
            }).catch(err => logger.error(`Failed to send refund email: ${err.message}`));
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
exports.createStripeCheckoutSession = async (userId, amount) => {
    // 1. Convert amount to cents for Stripe
    const amountInCents = Math.round(amount * 100);

    // 2. Create Checkout Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'inr',
                    product_data: {
                        name: 'SkillBridge Wallet Top-up',
                        description: `Add ₹${amount} to your professional wallet.`,
                    },
                    unit_amount: amountInCents,
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: `${config.FRONTEND_URL}/wallet/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.FRONTEND_URL}/wallet/cancel`,
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
exports.createJobCheckoutSession = async (jobId, userId) => {
    const job = await Job.findById(jobId).populate('selected_worker_id');
    if (!job) throw new Error('Job not found');

    const amount = job.diagnosis_report.final_total_cost;
    const breakdown = await this.calculateBreakdown(amount, job.selected_worker_id);

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'inr',
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
        success_url: `${config.FRONTEND_URL}/payment/success?jobId=${jobId}`,
        cancel_url: `${config.FRONTEND_URL}/payment/cancel?jobId=${jobId}`,
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
