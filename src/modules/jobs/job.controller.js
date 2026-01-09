const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');

// Create a new job
exports.createJob = async (req, res) => {
    try {
        const { job_title, job_description, skill_required, location, urgency_level, quotation_window_hours } = req.body;

        // Calculate timestamps
        const quotation_start_time = new Date();
        const hours = quotation_window_hours || 24;
        const quotation_end_time = new Date(quotation_start_time.getTime() + hours * 60 * 60 * 1000);

        const is_emergency = urgency_level === 'emergency';

        // location expected from frontend: { lat: 123, lng: 456, address_text: "..." }

        const job = new Job({
            user_id: req.user._id, // Auth middleware populates req.user
            job_title,
            job_description,
            skill_required,
            location: {
                lat: location.lat,
                lng: location.lng,
                address_text: location.address_text
            },
            urgency_level,

            quotation_window_hours: hours,
            quotation_start_time,
            quotation_end_time,
            is_emergency,
            status: 'open'
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
        skills: { $in: [job.skill_required] },
        verificationStatus: 'verified'
    }).select('user');

    if (matchedWorkers.length === 0) return;

    const workerUserIds = matchedWorkers.map(w => w.user);

    // 2. Filter these Ids by LOCATION (using User model's 2dsphere index)
    // Max distance: 10km (10000 meters)
    // We construct the GeoJSON point from our flat lat/lng for the User query
    const nearbyUsers = await User.find({
        _id: { $in: workerUserIds },
        location: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [job.location.lng, job.location.lat]
                },
                $maxDistance: 10000 // 10km radius
            }
        }
    }).select('_id fcmToken');

    console.log(`Found ${nearbyUsers.length} nearby workers for job ${job._id}`);

    // 3. Create Notifications
    const notifications = nearbyUsers.map(user => ({
        recipient: user._id,
        title: job.is_emergency ? '🚨 URGENT JOB ALERT!' : 'New Job Alert!',
        message: `${job.is_emergency ? 'IMMEDIATE HELP NEEDED: ' : ''}A new ${job.skill_required} job match found near you: ${job.job_title}`,
        type: 'job_alert',
        data: { jobId: job._id }
    }));

    if (notifications.length > 0) {
        await Notification.insertMany(notifications);
    }
}

exports.getJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id).populate('user_id', 'name phone address');

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
        job.selected_worker_id = req.user._id;
        await job.save();

        // Create Notification for User
        await Notification.create({
            recipient: job.user_id,
            title: 'Job Accepted',
            message: `A worker has accepted your job request: ${job.job_title}`,
            type: 'system',
            data: { jobId: job._id }
        });

        res.json({ success: true, message: 'Job accepted successfully', data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
    */
};
