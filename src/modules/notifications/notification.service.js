const Notification = require('./notification.model');
const logger = require('../../config/logger');

const { getIo } = require('../../socket/socket');

exports.createNotification = async (data) => {
    // Deduplication logic: If an unread notification of the exact same type and jobId exists, 
    // remove it so it's replaced by the new one, preventing notification spam.
    if (data.data && data.data.jobId && data.type) {
        try {
            await Notification.deleteMany({
                recipient: data.recipient,
                type: data.type,
                'data.jobId': data.data.jobId,
                read: false
            });
        } catch (e) {
            logger.error('Error during notification deduplication:', e);
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
