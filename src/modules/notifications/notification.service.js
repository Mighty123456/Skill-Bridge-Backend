const Notification = require('./notification.model');
const logger = require('../../config/logger');

const { getIo } = require('../../socket/socket');

exports.createNotification = async (data) => {
    // --- MNC STANDARD: Job-Level Aggregation & Deduplication ---
    // Instead of flooding the UI, we consolidate updates for the same job.
    if (data.data && data.data.jobId) {
        try {
            const existingNotification = await Notification.findOne({
                recipient: data.recipient,
                'data.jobId': data.data.jobId,
                read: false
            });

            if (existingNotification) {
                // If it's a quotation, increment count
                if (data.type === 'quotation_received' && existingNotification.type === 'quotation_received') {
                    let count = existingNotification.data.count || 1;
                    count += 1;
                    existingNotification.message = `You have received ${count} new quotations for your job.`;
                    existingNotification.data = { ...existingNotification.data, count };
                    existingNotification.updatedAt = new Date();
                    await existingNotification.save();

                    const io = getIo();
                    io.to(data.recipient.toString()).emit('notification_updated', existingNotification);
                    return existingNotification;
                }

                // For other job updates (Started -> Arrived -> Completed), 
                // we replace the old unread one with the new status to keep the feed clean.
                // This prevents "Notification Bloat" for the same job.
                if (existingNotification.type !== 'payment' && data.type !== 'payment') {
                    await Notification.deleteOne({ _id: existingNotification._id });
                    logger.info(`Deduplicated notification for job ${data.data.jobId} (Type: ${data.type})`);
                }
            }
        } catch (e) {
            logger.error('Error during notification aggregation:', e);
        }
    }

    const notification = await Notification.create(data);

    // Attempt real-time delivery via Socket.io
    try {
        const io = getIo();
        const recipientRoom = data.recipient.toString();
        io.to(recipientRoom).emit('notification', notification);
    } catch (err) {
        // Socket not initialized or connection error
    }

    return notification;
};

/**
 * Cleans up transient notifications for a job that is no longer in a specific state.
 * E.g. When a job is assigned, we delete "Job Alert" notifications for everyone else.
 */
exports.cleanupJobNotifications = async (jobId, types = []) => {
    try {
        const query = { 'data.jobId': jobId };
        if (types.length > 0) {
            query.type = { $in: types };
        }
        const result = await Notification.deleteMany(query);
        logger.info(`Cleaned up ${result.deletedCount} notifications for job ${jobId}`);
        return result.deletedCount;
    } catch (err) {
        logger.error(`Failed to cleanup notifications for job ${jobId}:`, err);
    }
};

exports.sendThrottledJobAlerts = async (users, job) => {
    const notifications = [];
    const THRESHOLD_MINS = 60;
    const MAX_ALERTS_PER_HOUR = 10;

    for (const user of users) {
        try {
            // Check throttling: How many job alerts sent to this user in last hour?
            const recentAlerts = await Notification.countDocuments({
                recipient: user._id,
                type: 'job_alert',
                createdAt: { $gt: new Date(Date.now() - THRESHOLD_MINS * 60 * 1000) }
            });

            if (recentAlerts >= MAX_ALERTS_PER_HOUR) {
                logger.info(`Throttling notification for user ${user._id} (Count: ${recentAlerts})`);
                continue; // Skip this user
            }

            notifications.push({
                recipient: user._id,
                title: job.is_emergency ? '🚨 URGENT JOB ALERT!' : 'New Job Alert!',
                message: `${job.is_emergency ? 'IMMEDIATE HELP NEEDED: ' : ''}A new ${job.skill_required} job match found near you: ${job.job_title}`,
                type: 'job_alert',
                data: { jobId: job._id }
            });

        } catch (err) {
            logger.error('Error checking throttle:', err);
        }
    }

    if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        logger.info(`Sent ${notifications.length} job alerts.`);
    }
};
