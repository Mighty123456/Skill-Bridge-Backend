const Notification = require('./notification.model');
const logger = require('../../config/logger');

exports.createNotification = async (data) => {
    return await Notification.create(data);
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
