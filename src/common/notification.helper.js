/**
 * notification.helper.js
 *
 * The central "Multi-Channel Notification Dispatcher" for SkillBridge.
 *
 * This helper coordinates 3 channels for every event:
 *   1. 🔔 FCM Push      – For immediate, actionable alerts (app must be installed)
 *   2. 📧 Email         – For permanent records & rich content (always works)
 *   3. 🗄️  In-App DB    – For the notification bell inside the app
 *
 * Usage:
 *   const notifyHelper = require('./notification.helper');
 *   await notifyHelper.onNewJobPosted(workers, job);
 *   await notifyHelper.onQuotationReceived(tenant, job, quotation);
 */

const notificationService = require('../modules/notifications/notification.service');
const emailService = require('./services/email.service');
const { sendPushNotification } = require('./services/fcm.service');
const User = require('../modules/users/user.model');
const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER: Send push to a user by their DB userId
// Fetches their FCM tokens, sends, and cleans up stale tokens automatically.
// ─────────────────────────────────────────────────────────────────────────────
const _sendPushToUser = async (userId, title, body, data = {}, collapseKey = null) => {
    try {
        const user = await User.findById(userId).select('fcmTokens');
        if (!user || !user.fcmTokens || user.fcmTokens.length === 0) return;

        const result = await sendPushNotification(user.fcmTokens, { title, body }, data, collapseKey);

        // Auto-clean stale/invalid tokens from the user's record
        if (result.invalidTokens && result.invalidTokens.length > 0) {
            await User.findByIdAndUpdate(userId, {
                $pull: { fcmTokens: { $in: result.invalidTokens } },
            });
            logger.info(`FCM: Cleaned ${result.invalidTokens.length} stale token(s) for user ${userId}`);
        }
    } catch (err) {
        logger.error(`FCM: _sendPushToUser error for user ${userId}: ${err.message}`);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPER: Send push to MULTIPLE users (e.g., broadcast to all workers)
// ─────────────────────────────────────────────────────────────────────────────
const _sendPushToUsers = async (userIds, title, body, data = {}) => {
    // Run all push sends in parallel for performance
    await Promise.all(userIds.map((id) => _sendPushToUser(id, title, body, data)));
};

// =============================================================================
// ✅ EVENT 1: New Job Posted → Notify matching workers
// =============================================================================
exports.onNewJobPosted = async (matchingWorkers, job) => {
    const isEmergency = job.is_emergency;
    const title = isEmergency ? '🚨 URGENT JOB ALERT!' : '🔧 New Job Match!';
    const body = `${isEmergency ? 'IMMEDIATE HELP NEEDED: ' : ''}A new ${job.skill_required} job is available near you: "${job.job_title}"`;
    const workerIds = matchingWorkers.map((w) => w._id || w);

    // FCM Push to all matching workers
    await _sendPushToUsers(workerIds, title, body, {
        type: 'job_alert',
        jobId: String(job._id),
        isEmergency: String(isEmergency),
        recipientRole: 'worker',
    });

    // In-App Notifications (uses existing throttle logic from notification.service)
    await notificationService.sendThrottledJobAlerts(matchingWorkers, job);

    logger.info(`[NotifyHelper] onNewJobPosted: Notified ${workerIds.length} workers for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 2: Quotation Submitted → Notify Tenant
// =============================================================================
exports.onQuotationReceived = async (tenant, job, quotationData) => {
    const title = '💼 New Quotation Received!';
    const body = `${quotationData.workerName} submitted a quote of ₹${quotationData.amount} for "${job.job_title}"`;
    const collapseKey = `quotations_job_${job._id}`; // Collapses all quote pushes into one

    // FCM Push (replaces previous quote notification for same job)
    await _sendPushToUser(tenant._id, title, body, {
        type: 'quotation_received',
        jobId: String(job._id),
        recipientRole: 'tenant',
    }, collapseKey);

    // In-App DB notification (uses existing aggregation logic)
    await notificationService.createNotification({
        recipient: tenant._id,
        title,
        message: body,
        type: 'quotation_received',
        data: { jobId: job._id },
    });

    // No email for every quote – avoids spam (FCM is enough here)
    logger.info(`[NotifyHelper] onQuotationReceived: Tenant ${tenant._id} notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 3: Quotation Accepted → Notify Worker
// =============================================================================
exports.onQuotationAccepted = async (worker, job, totalCost) => {
    const title = '🎉 Quotation Accepted!';
    const body = `Your quote was accepted for "${job.job_title}". Time to get to work!`;

    // FCM Push
    await _sendPushToUser(worker._id, title, body, {
        type: 'quotation_accepted',
        jobId: String(job._id),
        recipientRole: 'worker',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: worker._id,
        title,
        message: body,
        type: 'quotation_accepted',
        data: { jobId: job._id },
    });

    // Email (permanent record for the worker)
    if (worker.email) {
        await emailService.sendQuotationAcceptedEmail(worker.email, worker.name, job.job_title, totalCost);
    }

    logger.info(`[NotifyHelper] onQuotationAccepted: Worker ${worker._id} notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 4: Job Started → Notify Tenant that worker is on the way
// =============================================================================
exports.onJobStarted = async (tenant, job, workerName) => {
    const title = '🚗 Worker is On the Way!';
    const body = `${workerName} has started and is on the way to your location for "${job.job_title}"`;

    // FCM Push
    await _sendPushToUser(tenant._id, title, body, {
        type: 'job_started',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: tenant._id,
        title,
        message: body,
        type: 'job_started',
        data: { jobId: job._id },
    });

    logger.info(`[NotifyHelper] onJobStarted: Tenant ${tenant._id} notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 5: Diagnosis Report Ready → Notify Tenant to Approve & Pay
// =============================================================================
exports.onDiagnosisReady = async (tenant, job, finalCost) => {
    const title = '📋 Diagnosis Report Ready';
    const body = `Your worker submitted a diagnosis for "${job.job_title}". Final cost: ₹${finalCost}. Please review and approve.`;

    // FCM Push (action required – high priority)
    await _sendPushToUser(tenant._id, title, body, {
        type: 'action_required',
        jobId: String(job._id),
        screen: 'diagnosis',
        recipientRole: 'tenant',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: tenant._id,
        title,
        message: body,
        type: 'action_required',
        data: { jobId: job._id },
    });

    logger.info(`[NotifyHelper] onDiagnosisReady: Tenant ${tenant._id} notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 5.5: ETA Confirmed → Notify Tenant
// =============================================================================
exports.onEtaConfirmed = async (tenant, job, etaTime) => {
    const formattedTime = new Date(etaTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const title = '🕒 Arrival Time Confirmed';
    const body = `Your worker confirmed they will arrive around ${formattedTime} for "${job.job_title}"`;

    await _sendPushToUser(tenant._id, title, body, {
        type: 'info',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    await notificationService.createNotification({
        recipient: tenant._id, title, message: body,
        type: 'info', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 5.6: Worker Arrived → Notify Tenant
// =============================================================================
exports.onWorkerArrived = async (tenant, job) => {
    const title = '📍 Worker Arrived!';
    const body = `Your worker has arrived at your location for "${job.job_title}". Please share the start OTP.`;

    await _sendPushToUser(tenant._id, title, body, {
        type: 'action_required',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    await notificationService.createNotification({
        recipient: tenant._id, title, message: body,
        type: 'action_required', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 5.7: Worker Delayed → Notify Tenant
// =============================================================================
exports.onWorkerDelayed = async (tenant, job, reason) => {
    const title = '⏳ Worker Delayed';
    const body = `Your worker for "${job.job_title}" reported a delay: ${reason}.`;

    await _sendPushToUser(tenant._id, title, body, {
        type: 'alert',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    await notificationService.createNotification({
        recipient: tenant._id, title, message: body,
        type: 'alert', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 6: Job Completed → Notify Tenant to Release Payment
// =============================================================================
exports.onJobCompleted = async (tenant, job) => {
    const title = '✅ Job Completed!';
    const body = `The worker has marked "${job.job_title}" as complete. Please review and release payment.`;

    // FCM Push
    await _sendPushToUser(tenant._id, title, body, {
        type: 'completion_review',
        jobId: String(job._id),
        screen: 'job_completion',
        recipientRole: 'tenant',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: tenant._id,
        title,
        message: body,
        type: 'completion_review',
        data: { jobId: job._id },
    });

    logger.info(`[NotifyHelper] onJobCompleted: Tenant ${tenant._id} notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 6.5: Job Cancelled → Notify Counterparty
// =============================================================================
exports.onJobCancelled = async (recipientId, job, cancelledByRole, reason) => {
    const title = '❌ Job Cancelled';
    const body = `The job "${job.job_title}" has been cancelled by the ${cancelledByRole}. Reason: ${reason}`;
    const recipientRole = cancelledByRole === 'user' ? 'worker' : 'tenant';

    await _sendPushToUser(recipientId, title, body, {
        type: 'alert',
        jobId: String(job._id),
        recipientRole,
    });

    await notificationService.createNotification({
        recipient: recipientId, title, message: body,
        type: 'alert', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 7: Payment Escrowed → Notify both Tenant and Worker
// =============================================================================
exports.onPaymentEscrowed = async (tenant, worker, job, paymentData) => {
    // Notify Tenant
    const tenantTitle = '🔒 Payment Secured in Escrow';
    const tenantBody = `₹${paymentData.totalAmount.toFixed(2)} has been safely secured for "${job.job_title}"`;
    await _sendPushToUser(tenant._id, tenantTitle, tenantBody, {
        type: 'payment',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });
    await notificationService.createNotification({
        recipient: tenant._id, title: tenantTitle, message: tenantBody,
        type: 'payment', data: { jobId: job._id },
    });
    if (tenant.email) {
        await emailService.sendPaymentEscrowedUser(tenant.email, { ...paymentData, jobId: job._id });
    }

    // Notify Worker
    const workerTitle = '🚀 Funds Secured – Start Working!';
    const workerBody = `Payment for "${job.job_title}" is secured. You can now proceed with the job.`;
    await _sendPushToUser(worker._id, workerTitle, workerBody, {
        type: 'payment',
        jobId: String(job._id),
        recipientRole: 'worker',
    });
    await notificationService.createNotification({
        recipient: worker._id, title: workerTitle, message: workerBody,
        type: 'payment', data: { jobId: job._id },
    });
    if (worker.email) {
        await emailService.sendPaymentEscrowedWorker(worker.email, paymentData);
    }

    logger.info(`[NotifyHelper] onPaymentEscrowed: Both tenant ${tenant._id} and worker ${worker._id} notified.`);
};

// =============================================================================
// ✅ EVENT 8: Payment Released → Notify Worker (Payout!)
// =============================================================================
exports.onPaymentReleased = async (worker, job, payoutData) => {
    const title = '💰 Money is in Your Wallet!';
    const body = `₹${payoutData.netPayout.toFixed(2)} has been credited to your SkillBridge wallet for "${job.job_title}"`;

    // FCM Push
    await _sendPushToUser(worker._id, title, body, {
        type: 'payment_received',
        jobId: String(job._id),
        screen: 'wallet',
        recipientRole: 'worker',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: worker._id,
        title,
        message: body,
        type: 'payment_received',
        data: { jobId: job._id },
    });

    // Email (permanent financial record)
    if (worker.email) {
        await emailService.sendPaymentReleasedWorker(worker.email, {
            workerName: worker.name,
            jobTitle: job.job_title,
            netPayout: payoutData.netPayout,
        });
    }

    logger.info(`[NotifyHelper] onPaymentReleased: Worker ${worker._id} payout notification sent.`);
};

// =============================================================================
// ✅ EVENT 9: New Chat Message → Notify recipient (when app is in background)
// =============================================================================
exports.onNewChatMessage = async (recipientId, senderName, messagePreview, chatId, senderId, jobId) => {
    const title = `💬 New message from ${senderName}`;
    const body = messagePreview.length > 60 ? `${messagePreview.substring(0, 57)}...` : messagePreview;

    // FCM Push Only (Socket.io handles foreground; FCM handles background)
    await _sendPushToUser(recipientId, title, body, {
        type: 'chat_message',
        screen: 'chat',
        chatId: String(chatId),
        recipientId: String(senderId), // For the recipient, the sender is the peer they're chatting with
        recipientName: senderName,
        jobId: String(jobId),
    }, `chat_${recipientId}`); // Collapse key: only show 1 chat badge at a time

    logger.info(`[NotifyHelper] onNewChatMessage: Recipient ${recipientId} push sent.`);
};

// =============================================================================
// ✅ EVENT 10: Support Ticket Update → Notify the ticket owner
// =============================================================================
exports.onTicketUpdated = async (user, ticketId, updateMessage) => {
    const title = '🎫 Support Ticket Update';
    const body = updateMessage.length > 80 ? `${updateMessage.substring(0, 77)}...` : updateMessage;

    // FCM Push
    await _sendPushToUser(user._id, title, body, {
        type: 'info',
        ticketId: String(ticketId),
        screen: 'help_center',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: user._id,
        title,
        message: body,
        type: 'info',
        data: { ticketId },
    });

    logger.info(`[NotifyHelper] onTicketUpdated: User ${user._id} notified for ticket ${ticketId}`);
};

// =============================================================================
// ✅ EVENT 10.5: Material Requested → Notify Tenant
// =============================================================================
exports.onMaterialRequested = async (tenant, job, itemName, cost) => {
    const title = '🛠️ Material Approval Needed';
    const body = `Worker requested ₹${cost} for "${itemName}" on job "${job.job_title}". Please approve to proceed.`;

    await _sendPushToUser(tenant._id, title, body, {
        type: 'action_required',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    await notificationService.createNotification({
        recipient: tenant._id, title, message: body,
        type: 'action_required', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 11: Worker Verification Status Change → Notify Worker
// =============================================================================
exports.onVerificationUpdate = async (worker, status, reason = '') => {
    const isApproved = status === 'verified';
    const title = isApproved ? '✅ Profile Verified!' : '⚠️ Verification Action Required';
    const body = isApproved
        ? 'Congratulations! Your SkillBridge profile is now verified. You can start accepting jobs.'
        : `Your verification needs attention. ${reason || 'Please check your profile for details.'}`;

    // FCM Push
    await _sendPushToUser(worker._id, title, body, {
        type: 'system',
        screen: 'profile',
        recipientRole: 'worker',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: worker._id,
        title,
        message: body,
        type: 'system',
        data: {},
    });

    // Email (formal record of the decision)
    if (worker.email) {
        await emailService.sendVerificationEmail(worker.email, worker.name, status, reason);
    }

    logger.info(`[NotifyHelper] onVerificationUpdate: Worker ${worker._id} verification (${status}) notified.`);
};

// =============================================================================
// ✅ EVENT 12: Refund Processed → Notify User
// =============================================================================
exports.onRefundProcessed = async (tenant, job, amount) => {
    const title = '💰 Refund Processed';
    const body = `A refund of ₹${amount.toFixed(2)} for "${job.job_title}" has been credited to your wallet.`;

    // FCM Push
    await _sendPushToUser(tenant._id, title, body, {
        type: 'payment',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    // In-App DB
    await notificationService.createNotification({
        recipient: tenant._id,
        title,
        message: body,
        type: 'payment',
        data: { jobId: job._id },
    });

    logger.info(`[NotifyHelper] onRefundProcessed: Tenant ${tenant._id} notified.`);
};

// =============================================================================
// ✅ EVENT 12.5: Dispute Raised → Notify Worker
// =============================================================================
exports.onDisputeRaised = async (worker, job, reason) => {
    const title = '⚖️ Dispute Raised';
    const body = `A dispute has been raised for "${job.job_title}". Payment is on hold until admin review.`;

    await _sendPushToUser(worker._id, title, body, {
        type: 'dispute',
        jobId: String(job._id),
        recipientRole: 'worker',
    });

    await notificationService.createNotification({
        recipient: worker._id, title, message: body,
        type: 'dispute', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 13: Dispute Resolved / Settlement → Notify both parties
// =============================================================================
exports.onSettlementProcessed = async (tenant, worker, job, tenantAmount, workerAmount) => {
    // Notify Tenant
    const tTitle = '⚖️ Dispute Resolved';
    const tBody = `The dispute for "${job.job_title}" is resolved. You received a refund of ₹${tenantAmount.toFixed(2)}.`;
    await _sendPushToUser(tenant._id, tTitle, tBody, {
        type: 'payment',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });
    await notificationService.createNotification({
        recipient: tenant._id, title: tTitle, message: tBody,
        type: 'payment', data: { jobId: job._id },
    });

    // Notify Worker
    const wTitle = '⚖️ Dispute Resolved';
    const wBody = `The dispute for "${job.job_title}" is resolved. You have been paid ₹${workerAmount.toFixed(2)}.`;
    await _sendPushToUser(worker._id, wTitle, wBody, {
        type: 'payment',
        jobId: String(job._id),
        recipientRole: 'worker',
    });
    await notificationService.createNotification({
        recipient: worker._id, title: wTitle, message: wBody,
        type: 'payment', data: { jobId: job._id },
    });

    logger.info(`[NotifyHelper] onSettlementProcessed: Both parties notified for job ${job._id}`);
};

// =============================================================================
// ✅ EVENT 13.5: Warranty Claimed → Notify Worker
// =============================================================================
exports.onWarrantyClaimed = async (worker, job, reason) => {
    const title = '🛡️ Warranty Claim Raised';
    const body = `Client reported an issue for "${job.job_title}": "${reason}". Please contact them.`;

    await _sendPushToUser(worker._id, title, body, {
        type: 'warranty',
        jobId: String(job._id),
        recipientRole: 'worker',
    });

    await notificationService.createNotification({
        recipient: worker._id, title, message: body,
        type: 'warranty', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 13.6: Warranty Resolved → Notify Tenant
// =============================================================================
exports.onWarrantyResolved = async (tenant, job) => {
    const title = '🛡️ Warranty Issue Resolved';
    const body = `The warranty claim for "${job.job_title}" has been marked as resolved by the worker.`;

    await _sendPushToUser(tenant._id, title, body, {
        type: 'info',
        jobId: String(job._id),
        recipientRole: 'tenant',
    });

    await notificationService.createNotification({
        recipient: tenant._id, title, message: body,
        type: 'info', data: { jobId: job._id },
    });
};

// =============================================================================
// ✅ EVENT 14: System Broadcast → Notify large groups of users
// =============================================================================
exports.onBroadcast = async (users, title, body, type = 'system') => {
    const userIds = users.map(u => u._id || u);

    // 1. FCM Push to all targeting users
    // (multicast handled inside _sendPushToUsers)
    await _sendPushToUsers(userIds, title, body, { type, broadcast: 'true' });

    // 2. In-App DB Notifications (In bulk if possible, or loop)
    // Note: notificationService.createNotification handles single. 
    // For bulk, we might want a bulk version, but let's stick to safe loop for now.
    await Promise.all(userIds.map(id =>
        notificationService.createNotification({
            recipient: id,
            title,
            message: body,
            type,
            data: { broadcast: true }
        })
    ));

    logger.info(`[NotifyHelper] onBroadcast: Sent broadcast to ${userIds.length} users.`);
};

// =============================================================================
// ✅ EVENT 15: Wallet Transaction (Topup, Released Funds) -> Notify User
// =============================================================================
exports.onWalletTransaction = async (userId, title, body, data) => {
    await _sendPushToUser(userId, title, body, {
        type: 'payment',
        screen: 'wallet',
        ...data
    });

    await notificationService.createNotification({
        recipient: userId,
        title,
        message: body,
        type: 'payment',
        data
    });
};

// =============================================================================
// ✅ EVENT 16: Withdrawal Request/Processed -> Notify Worker
// =============================================================================
exports.onWithdrawalStatus = async (userId, title, body, data) => {
    await _sendPushToUser(userId, title, body, {
        type: 'payment',
        screen: 'wallet',
        ...data
    });

    await notificationService.createNotification({
        recipient: userId,
        title,
        message: body,
        type: 'payment',
        data
    });
};

// =============================================================================
// ✅ EVENT 17: General Job Status Update -> Notify User
// =============================================================================
exports.onJobStatusUpdate = async (userId, title, body, data) => {
    await _sendPushToUser(userId, title, body, {
        type: 'info',
        ...data
    });

    await notificationService.createNotification({
        recipient: userId,
        title,
        message: body,
        type: data.type || 'info', // Fallback to info if type not specified
        data
    });
};
