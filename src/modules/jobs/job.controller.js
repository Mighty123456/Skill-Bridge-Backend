const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');

// Create a new job
exports.createJob = async (req, res) => {
    try {
        const { title, description, skill, location, urgency, budget, quotationWindowDays } = req.body;

        // 1. Prepare Job Data
        // location matches GeoJSON User format: { type: 'Point', coordinates: [lng, lat], address: "..." }
        const quotationWindow = new Date(Date.now() + (quotationWindowDays || 1) * 24 * 60 * 60 * 1000);

        const job = new Job({
            title,
            description,
            skill,
            location: {
                type: 'Point',
                coordinates: location.coordinates, // API must send [lng, lat]
                address: location.address
            },
            urgency,
            budget,
            quotationWindow,
            postedBy: req.user._id, // Assumes auth middleware populates req.user
        });

        await job.save();

        // 2. Trigger async nearby worker discovery (don't block response)
        findAndNotifyWorkers(job).catch(err => console.error('Error notifying workers:', err));

        res.status(201).json({
            success: true,
            message: 'Job posted successfully',
            data: job
        });

    } catch (error) {
        console.error('Create Job Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to post job',
            error: error.message
        });
    }
};

// Helper function to find and notify workers
async function findAndNotifyWorkers(job) {
    // 1. Find Workers with matching SKILL and VERIFIED status
    const matchedWorkers = await Worker.find({
        skills: { $in: [job.skill] }, // "Plumber" in ["Plumber", "Electrician"]
        verificationStatus: 'verified'
    }).select('user');

    if (matchedWorkers.length === 0) return;

    const workerUserIds = matchedWorkers.map(w => w.user);

    // 2. Filter these Ids by LOCATION (using User model's 2dsphere index)
    // Max distance: 10km (10000 meters)
    const nearbyUsers = await User.find({
        _id: { $in: workerUserIds },
        location: {
            $near: {
                $geometry: job.location, // { type: "Point", coordinates: [lng, lat] }
                $maxDistance: 10000 // 10km radius
            }
        }
    }).select('_id fcmToken'); // Assuming we might want push tokens later

    console.log(`Found ${nearbyUsers.length} nearby workers for job ${job._id}`);

    // 3. Create Notifications
    const notifications = nearbyUsers.map(user => ({
        recipient: user._id,
        title: job.urgency === 'emergency' ? '🚨 URGENT JOB ALERT!' : 'New Job Alert!',
        message: `${job.urgency === 'emergency' ? 'IMMEDIATE HELP NEEDED: ' : ''}A new ${job.skill} job match found near you: ${job.title}`,
        type: 'job_alert',
        data: { jobId: job._id }
    }));

    if (notifications.length > 0) {
        await Notification.insertMany(notifications);
        // TODO: Emit Socket.io event here
        // global.io.to(user._id).emit('notification', ...)
    }
}

exports.getJob = async (req, res) => {
    try {
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
    return res.status(400).json({ success: false, message: 'Direct acceptance is disabled. Please wait for Quotation System in Phase 3.' });
    /*
    try {
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
    */
};
