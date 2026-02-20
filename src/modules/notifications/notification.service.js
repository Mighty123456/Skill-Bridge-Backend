const Notification = require('./notification.model');
const logger = require('../../config/logger');

const { getIo } = require('../../socket/socket');

exports.createNotification = async (data) => {
    // --- MNC STANDARD: Notification Aggregation & Deduplication ---
    // If a notification of the same type for the same job already exists and is unread,
    // we aggregate them (e.g., "You have 3 new quotations for...") instead of spamming.
    if (data.data && data.data.jobId && data.type) {
        try {
            const existingNotification = await Notification.findOne({
                recipient: data.recipient,
                type: data.type,
                'data.jobId': data.data.jobId,
                read: false
            });

            if (existingNotification) {
                // If the notification type is something quantitative like quotations, we aggregate
                if (data.type === 'quotation_received') {
                    // Extract current count or default to 1
                    let count = existingNotification.data.count || 1;
                    count += 1;

                    // Update existing notification with new grouped message
                    existingNotification.message = `You have received ${count} new quotations for your job.`;
                    existingNotification.data = { ...existingNotification.data, count };
                    existingNotification.updatedAt = new Date();

                    await existingNotification.save();

                    // Fire socket event for the updated notification
                    const io = getIo();
                    io.to(data.recipient.toString()).emit('notification_updated', existingNotification);
                    return existingNotification;
                } else {
                    // For state-based alerts (e.g., "Job Started", "Review Completion")
                    // we simply delete the old one and let the new one take its place at the top of the feed (Deduplication)
                    await Notification.deleteOne({ _id: existingNotification._id });
                }
            }
        } catch (e) {
            logger.error('Error during notification deduplication/aggregation:', e);
        }
    }

    const notification = await Notification.create(data);

    // Attempt real-time delivery via Socket.io
    try {
        const io = getIo();
        const recipientRoom = data.recipient.toString();
        io.to(recipientRoom).emit('notification', notification);
    } catch (err) {
        // Socket not initialized or connection error - silent fail as it's saved in DB
    }

    return notification;
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
