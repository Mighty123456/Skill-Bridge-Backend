exports.getJob = async (req, res) => {
    try {
        const Job = require('./job.model');
        const job = await Job.findById(req.params.id).populate('postedBy', 'name phone address');

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        res.json({ success: true, data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.acceptJob = async (req, res) => {
    try {
        const Job = require('./job.model');
        const Notification = require('../notifications/notification.model');

        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (job.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Job is already taken or closed' });
        }

        // Assign worker
        job.status = 'in_progress';
        job.assignedTo = req.user._id;
        await job.save();

        // Create Notification for User
        await Notification.create({
            recipient: job.postedBy,
            title: 'Job Accepted',
            message: `A worker has accepted your job request: ${job.title}`,
            type: 'system',
            data: { jobId: job._id }
        });

        res.json({ success: true, message: 'Job accepted successfully', data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
