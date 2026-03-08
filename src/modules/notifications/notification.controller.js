const Notification = require('./notification.model');

exports.getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user._id })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json({
            success: true,
            data: notifications
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        // Ensure the notification belongs to the logged-in user
        const notification = await Notification.findOneAndUpdate(
            { _id: id, recipient: req.user._id },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        // Ensure the notification belongs to the logged-in user
        const notification = await Notification.findOneAndDelete({
            _id: id,
            recipient: req.user._id
        });

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user._id, read: false },
            { read: true }
        );
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.markReadByJob = async (req, res) => {
    try {
        const { jobId } = req.params;
        await Notification.updateMany(
            { recipient: req.user._id, 'data.jobId': jobId, read: false },
            { read: true }
        );
        res.json({ success: true, message: 'Job notifications marked as read' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteByJob = async (req, res) => {
    try {
        const { jobId } = req.params;
        const result = await Notification.deleteMany({
            recipient: req.user._id,
            'data.jobId': jobId
        });
        res.json({
            success: true,
            message: `Deleted ${result.deletedCount} notifications for this job`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
