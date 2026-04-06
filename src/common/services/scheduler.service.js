const cron = require('node-cron');
const Job = require('../../modules/jobs/job.model');
const JobService = require('../../modules/jobs/job.service');
const logger = require('../../config/logger');

/**
 * Initialize all scheduled tasks
 */
const initializeScheduler = () => {
    logger.info('⏰ Scheduler Service Initialized');

    // ─────────────────────────────────────────────────────────────────────
    // CRON 1: Every 10 min — Auto-finalize jobs past cooling window
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('*/10 * * * *', async () => {
        logger.info('🔍 Running Task: Auto-Finalizing Jobs...');
        try {
            const jobsToFinalize = await Job.find({
                status: 'cooling_window',
                'cooling_period.ends_at': { $lte: new Date() },
                'cooling_period.dispute_raised': false,
                payment_released: false
            });

            if (jobsToFinalize.length === 0) {
                logger.debug('No jobs eligible for auto-finalization.');
                return;
            }

            logger.info(`Found ${jobsToFinalize.length} jobs to finalize.`);

            for (const job of jobsToFinalize) {
                try {
                    await JobService.finalizeJob(job._id);
                    logger.info(`✅ Automatically finalized job ${job._id}`);
                } catch (jobErr) {
                    logger.error(`❌ Failed to auto-finalize job ${job._id}: ${jobErr.message}`);
                }
            }
        } catch (error) {
            logger.error(`Critical error in auto-finalization task: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 2: Every day at midnight — Dispute escalation alert
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 0 * * *', async () => {
        logger.info('🔍 Running Task: Checking for Overdue Disputes...');
        try {
            const overdueDisputes = await Job.find({
                'dispute.is_disputed': true,
                'dispute.status': 'open',
                'dispute.opened_at': { $lte: new Date(Date.now() - 48 * 60 * 60 * 1000) }
            });

            if (overdueDisputes.length > 0) {
                logger.warn(`⚠️ ALERT: ${overdueDisputes.length} disputes have been open for over 48 hours! Escalating to admin.`);
                for (const job of overdueDisputes) {
                    logger.warn(`- Job ${job._id} (User: ${job.user_id}) has an unresolved dispute from ${job.dispute.opened_at}`);
                }
            }
        } catch (error) {
            logger.error(`Critical error in dispute escalation task: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 3: Every hour — Release matured pending payouts & warranties
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 * * * *', async () => {
        logger.info('🔍 Running Task: Releasing Matured Pending Payouts...');
        try {
            const Wallet = require('../../modules/wallet/wallet.model');
            const WalletService = require('../../modules/wallet/wallet.service');

            const walletsWithPending = await Wallet.find({
                $or: [
                    { 'pendingPayouts.0': { $exists: true } },
                    { 'activeWarranties.0': { $exists: true } }
                ]
            });

            if (walletsWithPending.length === 0) return;

            let releasedCount = 0;
            for (const wallet of walletsWithPending) {
                try {
                    await WalletService.checkAndReleasePending(wallet.user);
                    releasedCount++;
                } catch (walletErr) {
                    logger.error(`Failed to release pending for wallet ${wallet._id}: ${walletErr.message}`);
                }
            }
            logger.info(`✅ Checked ${walletsWithPending.length} wallets, processed ${releasedCount} successfully.`);
        } catch (error) {
            logger.error(`Critical error in payout release task: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 4: Every 30 min — Auto-payout for Stripe Connect workers
    //   Workers with available balance + Stripe onboarded → auto-transfer
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('*/30 * * * *', async () => {
        logger.info('💰 Running Task: Auto-Payout for Stripe Connect Workers...');
        try {
            const Wallet = require('../../modules/wallet/wallet.model');
            const Worker = require('../../modules/workers/worker.model');
            const PaymentService = require('../../modules/payments/payment.service');
            const Withdrawal = require('../../modules/wallet/withdrawal.model');

            // Find workers who are Stripe-onboarded and have balance to pay out
            const onboardedWorkers = await Worker.find({
                stripeOnboarded: true,
                payoutEnabled: true,
                stripeAccountId: { $exists: true, $ne: null }
            }).select('user stripeAccountId consecutivePayoutFailures');

            if (onboardedWorkers.length === 0) return;

            let processedCount = 0;
            let failedCount = 0;
            const MIN_AUTO_PAYOUT = 100; // Minimum ₹100 for auto-payout

            for (const worker of onboardedWorkers) {
                try {
                    const wallet = await Wallet.findOne({ user: worker.user });
                    if (!wallet || wallet.balance < MIN_AUTO_PAYOUT) continue;

                    // Skip if worker has too many recent failures (will be handled by health check)
                    if (worker.consecutivePayoutFailures >= 3) continue;

                    // GUARD: Skip if worker has an active failed/processing withdrawal.
                    // Those funds are already "spoken for" and will be retried or refunded
                    // by CRON 5. Auto-paying them out here would create a parallel debit 
                    // without a matching Withdrawal record.
                    const activeFailedWithdrawal = await Withdrawal.findOne({
                        user: worker.user,
                        status: { $in: ['failed', 'processing'] }
                    });
                    if (activeFailedWithdrawal) {
                        logger.info(`⏭️ Auto-payout skipped for worker ${worker.user}: has active failed/processing withdrawal ${activeFailedWithdrawal._id}.`);
                        continue;
                    }

                    const payoutAmount = wallet.balance;

                    const result = await PaymentService.processStripeTransfer(
                        worker.user,
                        payoutAmount,
                        `AUTO_PAYOUT_${Date.now()}`
                    );

                    if (result.success) {
                        // Deduct from internal wallet since funds moved to Stripe
                        wallet.balance = 0;
                        await wallet.save();
                        processedCount++;
                        logger.info(`✅ Auto-payout ₹${payoutAmount} to worker ${worker.user} (Transfer: ${result.transferId})`);
                    } else {
                        failedCount++;
                        logger.warn(`⚠️ Auto-payout skipped for worker ${worker.user}: ${result.message}`);
                    }
                } catch (workerErr) {
                    failedCount++;
                    logger.error(`Auto-payout error for worker ${worker.user}: ${workerErr.message}`);
                }
            }

            if (processedCount > 0 || failedCount > 0) {
                logger.info(`💰 Auto-Payout Complete: ${processedCount} successful, ${failedCount} failed out of ${onboardedWorkers.length} eligible workers.`);
            }
        } catch (error) {
            logger.error(`Critical error in auto-payout task: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 5: Every 2 hours — Retry failed withdrawals
    //   Retries up to 3 times with increasing delay, then auto-refunds
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 */2 * * *', async () => {
        logger.info('🔄 Running Task: Retrying Failed Withdrawals...');
        try {
            const Withdrawal = require('../../modules/wallet/withdrawal.model');
            const Wallet = require('../../modules/wallet/wallet.model');
            const PaymentService = require('../../modules/payments/payment.service');
            const notifyHelper = require('../../common/notification.helper');

            // Find withdrawals that failed but haven't exhausted retries
            const failedWithdrawals = await Withdrawal.find({
                status: 'failed',
                retryCount: { $lt: 3 },
                refunded: { $ne: true } // Guard: skip already-refunded withdrawals
            }).populate('user', 'name email');

            if (failedWithdrawals.length === 0) {
                // Still need to check for exhausted ones below
            } else {
                logger.info(`Found ${failedWithdrawals.length} failed withdrawals to retry.`);

                for (const withdrawal of failedWithdrawals) {
                    try {
                        // Skip manual-method withdrawals — only Stripe payouts can be retried automatically
                        if (withdrawal.payoutMethod !== 'stripe') {
                            logger.info(`Skipping retry for withdrawal ${withdrawal._id}: payout method is '${withdrawal.payoutMethod}' (not Stripe).`);
                            continue;
                        }

                        // Exponential backoff: skip if last retry was too recent
                        // Retry 1: after 2 hours, Retry 2: after 4 hours, Retry 3: after 8 hours
                        const backoffMs = Math.pow(2, withdrawal.retryCount) * 2 * 60 * 60 * 1000;
                        if (withdrawal.lastRetryAt && (Date.now() - withdrawal.lastRetryAt.getTime()) < backoffMs) {
                            continue; // Too soon for next retry
                        }

                        withdrawal.retryCount += 1;
                        withdrawal.lastRetryAt = new Date();
                        withdrawal.status = 'processing';
                        await withdrawal.save();

                        // Attempt Stripe transfer
                        const result = await PaymentService.processStripeTransfer(
                            withdrawal.user._id || withdrawal.user,
                            withdrawal.netAmount,
                            `WITHDRAWAL_RETRY_${withdrawal._id}`
                        );

                        if (result.success) {
                            withdrawal.status = 'completed';
                            withdrawal.processedAt = new Date();
                            withdrawal.stripeTransferId = result.transferId;
                            withdrawal.failureReason = null;
                            withdrawal.refunded = false; // Funds sent — no refund required
                            await withdrawal.save();

                            logger.info(`✅ Withdrawal ${withdrawal._id} retry #${withdrawal.retryCount} successful. Transfer: ${result.transferId}`);

                            // Notify worker
                            await notifyHelper.onWithdrawalStatus(
                                withdrawal.user._id || withdrawal.user,
                                'Withdrawal Successful',
                                `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} has been processed after retry.`,
                                { withdrawalId: withdrawal._id, status: 'completed' }
                            );
                        } else {
                            withdrawal.status = 'failed';
                            withdrawal.failureReason = result.message;
                            await withdrawal.save();

                            logger.warn(`⚠️ Withdrawal ${withdrawal._id} retry #${withdrawal.retryCount} failed: ${result.message}`);
                        }
                    } catch (retryErr) {
                        withdrawal.status = 'failed';
                        withdrawal.failureReason = retryErr.message;
                        await withdrawal.save();
                        logger.error(`Withdrawal retry error for ${withdrawal._id}: ${retryErr.message}`);
                    }
                }
            }

            // Auto-refund withdrawals that exhausted all retries AND haven't been refunded yet
            const exhaustedWithdrawals = await Withdrawal.find({
                status: 'failed',
                retryCount: { $gte: 3 },
                refunded: { $ne: true } // KEY GUARD: only refund once
            }).populate('user', 'name email');

            for (const withdrawal of exhaustedWithdrawals) {
                try {
                    // Return funds to worker wallet — ONLY if not already refunded
                    const wallet = await Wallet.findOne({ user: withdrawal.user._id || withdrawal.user });
                    if (wallet) {
                        wallet.balance += withdrawal.amount;
                        await wallet.save();
                        logger.info(`💰 Refunded ₹${withdrawal.amount} to wallet for worker ${withdrawal.user._id || withdrawal.user}`);
                    }

                    withdrawal.refunded = true; // Mark as refunded to prevent future double-credits
                    withdrawal.status = 'rejected';
                    withdrawal.rejectionReason = `Auto-rejected after ${withdrawal.retryCount} failed payout attempts. Funds returned to wallet.`;
                    withdrawal.processedAt = new Date();
                    await withdrawal.save();

                    logger.warn(`🔁 Withdrawal ${withdrawal._id} auto-refunded after ${withdrawal.retryCount} failed retries. ₹${withdrawal.amount} returned to wallet.`);

                    // Notify worker
                    await notifyHelper.onWithdrawalStatus(
                        withdrawal.user._id || withdrawal.user,
                        'Withdrawal Auto-Refunded',
                        `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} could not be processed after multiple attempts. Funds have been returned to your wallet.`,
                        { withdrawalId: withdrawal._id, status: 'rejected' }
                    );
                } catch (refundErr) {
                    logger.error(`Auto-refund error for withdrawal ${withdrawal._id}: ${refundErr.message}`);
                }
            }
        } catch (error) {
            logger.error(`Critical error in withdrawal retry task: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 6: Daily at 2 AM — Stripe Connect health check
    //   Verifies connected account status, re-enables fixed accounts
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 2 * * *', async () => {
        logger.info('🏦 Running Task: Stripe Connect Health Check...');
        try {
            const Worker = require('../../modules/workers/worker.model');
            const config = require('../../config/env');
            const stripeKey = config.STRIPE_SECRET_KEY;
            if (!stripeKey) return;

            const stripe = require('stripe')(stripeKey);

            // Check workers who had disabled payouts or have error status
            const workersToCheck = await Worker.find({
                stripeAccountId: { $exists: true, $ne: null },
                $or: [
                    { payoutEnabled: false },
                    { consecutivePayoutFailures: { $gte: 1 } },
                ]
            });

            if (workersToCheck.length === 0) return;

            let reenabledCount = 0;
            let flaggedCount = 0;

            for (const worker of workersToCheck) {
                try {
                    const account = await stripe.accounts.retrieve(worker.stripeAccountId);

                    const chargesEnabled = account.charges_enabled;
                    const payoutsEnabled = account.payouts_enabled;
                    const detailsSubmitted = account.details_submitted;

                    if (chargesEnabled && payoutsEnabled && detailsSubmitted) {
                        // Account is healthy — re-enable if previously disabled
                        if (!worker.payoutEnabled || worker.consecutivePayoutFailures > 0) {
                            worker.payoutEnabled = true;
                            worker.consecutivePayoutFailures = 0;
                            worker.lastPayoutError = null;
                            worker.stripeOnboarded = true;
                            await worker.save();
                            reenabledCount++;
                            logger.info(`✅ Re-enabled payouts for worker ${worker.user} (Stripe account healthy)`);
                        }
                    } else {
                        // Account has issues
                        if (worker.stripeOnboarded) {
                            worker.stripeOnboarded = false; // Mark as needing re-onboarding
                            worker.lastPayoutError = `Stripe account issue: charges=${chargesEnabled}, payouts=${payoutsEnabled}, details=${detailsSubmitted}`;
                            await worker.save();
                            flaggedCount++;
                            logger.warn(`⚠️ Worker ${worker.user}: Stripe account needs attention (charges: ${chargesEnabled}, payouts: ${payoutsEnabled})`);
                        }
                    }
                } catch (stripeErr) {
                    // Account might be deleted or invalid
                    if (stripeErr.code === 'account_invalid' || stripeErr.statusCode === 404) {
                        worker.stripeOnboarded = false;
                        worker.payoutEnabled = false;
                        worker.lastPayoutError = 'Stripe account not found or invalid. Re-onboarding required.';
                        await worker.save();
                        flaggedCount++;
                        logger.warn(`⚠️ Worker ${worker.user}: Stripe account invalid/deleted`);
                    } else {
                        logger.error(`Stripe health check error for worker ${worker.user}: ${stripeErr.message}`);
                    }
                }
            }

            logger.info(`🏦 Health Check Complete: ${reenabledCount} re-enabled, ${flaggedCount} flagged out of ${workersToCheck.length} checked.`);
        } catch (error) {
            logger.error(`Critical error in Stripe health check: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 7: Daily at 3 AM — Stale withdrawal cleanup
    //   Auto-rejects withdrawals pending > 7 days, returns funds
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 3 * * *', async () => {
        logger.info('🧹 Running Task: Stale Withdrawal Cleanup...');
        try {
            const Withdrawal = require('../../modules/wallet/withdrawal.model');
            const Wallet = require('../../modules/wallet/wallet.model');
            const notifyHelper = require('../../common/notification.helper');

            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const staleWithdrawals = await Withdrawal.find({
                status: 'pending',
                createdAt: { $lte: sevenDaysAgo }
            }).populate('user', 'name email');

            if (staleWithdrawals.length === 0) return;

            logger.info(`Found ${staleWithdrawals.length} stale withdrawals (pending > 7 days).`);

            for (const withdrawal of staleWithdrawals) {
                try {
                    // Return funds to wallet
                    const wallet = await Wallet.findOne({ user: withdrawal.user._id || withdrawal.user });
                    if (wallet) {
                        wallet.balance += withdrawal.amount;
                        await wallet.save();
                    }

                    withdrawal.status = 'rejected';
                    withdrawal.rejectionReason = 'Auto-rejected: Withdrawal request was pending for over 7 days without admin action. Funds returned to wallet.';
                    withdrawal.processedAt = new Date();
                    await withdrawal.save();

                    // Notify worker
                    await notifyHelper.onWithdrawalStatus(
                        withdrawal.user._id || withdrawal.user,
                        'Withdrawal Expired',
                        `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} expired after 7 days. Funds returned to your wallet.`,
                        { withdrawalId: withdrawal._id, status: 'rejected' }
                    );

                    logger.info(`🧹 Auto-rejected stale withdrawal ${withdrawal._id}. ₹${withdrawal.amount} returned.`);
                } catch (cleanupErr) {
                    logger.error(`Stale withdrawal cleanup error for ${withdrawal._id}: ${cleanupErr.message}`);
                }
            }
        } catch (error) {
            logger.error(`Critical error in stale withdrawal cleanup: ${error.message}`);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // CRON 8: Every Monday at 1 AM — Auto-generate Billing Cycles
    //   Processes active hourly/retainer contracts for the previous week
    // ─────────────────────────────────────────────────────────────────────
    cron.schedule('0 1 * * 1', async () => {
        try {
            const ContractController = require('../../modules/contracts/contract.controller');
            await ContractController.processWeeklyBillingCycles();
        } catch (error) {
            logger.error(`Critical error in auto-billing cycle task: ${error.message}`);
        }
    });
};

module.exports = {
    initializeScheduler
};
