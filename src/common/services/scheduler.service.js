const cron = require('node-cron');
const Job = require('../../modules/jobs/job.model');
const JobService = require('../../modules/jobs/job.service');
const logger = require('../../config/logger');

/**
 * Initialize all scheduled tasks
 */
const initializeScheduler = () => {
    logger.info('⏰ Scheduler Service Initialized');

    // 1. Every 10 minutes: Finalize jobs past cooling window
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

    // 2. Every Day at Midnight: Dispute Escalation Alert
    cron.schedule('0 0 * * *', async () => {
        logger.info('🔍 Running Task: Checking for Overdue Disputes...');
        try {
            const overdueDisputes = await Job.find({
                'dispute.is_disputed': true,
                'dispute.status': 'open',
                'dispute.opened_at': { $lte: new Date(Date.now() - 48 * 60 * 60 * 1000) } // Older than 48h
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

    // 3. Every Hour: Release matured pending payouts
    cron.schedule('0 * * * *', async () => {
        logger.info('🔍 Running Task: Releasing Matured Pending Payouts...');
        try {
            const Wallet = require('../../modules/wallet/wallet.model');
            const WalletService = require('../../modules/wallet/wallet.service');

            const walletsWithPending = await Wallet.find({
                'pendingPayouts.0': { $exists: true }
            });

            if (walletsWithPending.length === 0) return;

            for (const wallet of walletsWithPending) {
                await WalletService.checkAndReleasePending(wallet.user);
            }
            logger.info(`✅ Released matured payouts for ${walletsWithPending.length} wallets.`);
        } catch (error) {
            logger.error(`Critical error in payout release task: ${error.message}`);
        }
    });
};

module.exports = {
    initializeScheduler
};
