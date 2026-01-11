const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');
const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
const logger = require('../../config/logger');

// Create a new job
exports.createJob = async (req, res) => {
    try {
        let { job_title, job_description, skill_required, location, urgency_level, quotation_window_hours } = req.body;

        // Handle stringified JSON from Multipart requests
        if (typeof location === 'string') {
            try {
                location = JSON.parse(location);
            } catch (e) {
                logger.warn('Failed to parse location JSON, keeping as is');
            }
        }

        // Calculate timestamps
        const quotation_start_time = new Date();
        const hours = Number(quotation_window_hours) || 24;
        const quotation_end_time = new Date(quotation_start_time.getTime() + hours * 60 * 60 * 1000);

        const is_emergency = urgency_level === 'emergency';

        // 1. Handle Image Uploads
        const issue_photos = [];
        if (req.files && req.files.length > 0) {
            logger.info(`Uploading ${req.files.length} job photos...`);
            const uploadPromises = req.files.map(file =>
                uploadOptimizedImage(file.buffer, `skillbridge/jobs/${req.user._id}`)
            );

            const uploadResults = await Promise.all(uploadPromises);
            uploadResults.forEach(result => issue_photos.push(result.url));
            logger.info(`Successfully uploaded ${issue_photos.length} photos`);
        }

        const job = new Job({
            user_id: req.user._id,
            job_title,
            job_description,
            skill_required,
            issue_photos,
            location: {
                type: 'Point',
                coordinates: [Number(location.lng), Number(location.lat)],
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

        // 2. Trigger async nearby worker discovery
        findAndNotifyWorkers(job).catch(err => logger.error('Error notifying workers:', err));

        res.status(201).json({
            success: true,
            message: 'Job posted successfully',
            data: job
        });

    } catch (error) {
        logger.error('Create Job Error:', error);
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
        const job = await Job.findById(req.params.id).populate('user_id', 'name phone address profileImage');

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // Check if current user (worker) has already submitted a quotation
        let hasSubmittedQuotation = false;
        if (req.user && req.user.role === 'worker') {
            const Quotation = require('../quotations/quotation.model');
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            hasSubmittedQuotation = !!existingQuotation;
        }

        res.json({
            success: true,
            data: {
                ...job._doc,
                hasSubmittedQuotation
            }
        });
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

// Get jobs feed for a worker (matching skills and location)
exports.getWorkerFeed = async (req, res) => {
    try {
        const workerUser = await User.findById(req.user._id);
        const workerProfile = await Worker.findOne({ user: req.user._id });

        if (!workerProfile) {
            return res.status(404).json({ success: false, message: 'Worker profile not found' });
        }

        // 1. Get Worker Skills
        const workerSkills = workerProfile.skills;

        if (!workerSkills || workerSkills.length === 0) {
            return res.json({ success: true, data: [] }); // No skills, no jobs
        }

        // 2. Find Open Jobs matching Skills
        let query = {
            status: 'open',
            skill_required: { $in: workerSkills }
        };

        if (workerUser && workerUser.location && workerUser.location.coordinates && workerUser.location.coordinates.length === 2) {
            query['location'] = {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: workerUser.location.coordinates
                    },
                    $maxDistance: 50000 // 50km
                }
            };
        } else {
            console.log('Worker location not available for proximity search, returning all matching skills');
        }

        const jobs = await Job.find(query)
            .sort({ is_emergency: -1, createdAt: -1 })
            .limit(20);

        // Enhance with hasSubmittedQuotation flag
        const Quotation = require('../quotations/quotation.model');
        const jobsWithFlags = await Promise.all(jobs.map(async (job) => {
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            return {
                ...job._doc,
                hasSubmittedQuotation: !!existingQuotation
            };
        }));

        res.json({ success: true, data: jobsWithFlags });

    } catch (error) {
        console.error('Get Worker Feed Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch jobs: ' + error.message });
    }
};

// Get jobs assigned to the worker
exports.getWorkerJobs = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {
            selected_worker_id: req.user._id
        };

        if (status === 'active') {
            query.status = { $in: ['in_progress', 'assigned', 'reviewing'] };
        } else if (status === 'completed') {
            query.status = 'completed';
        }

        const jobs = await Job.find(query)
            .sort({ updated_at: -1 })
            .populate('user_id', 'name phone address');

        res.json({ success: true, data: jobs });

    } catch (error) {
        console.error('Get Worker Jobs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch jobs' });
    }
};

// Get jobs posted by the tenant (user)
exports.getTenantJobs = async (req, res) => {
    try {
        const { status } = req.query; // 'open' (pending) or 'active' (in_progress)
        let query = {
            user_id: req.user._id
        };

        if (status === 'pending') {
            query.status = 'open';
        } else if (status === 'active') {
            query.status = { $in: ['in_progress', 'assigned', 'reviewing'] };
        } else if (status === 'completed') {
            query.status = 'completed';
        }

        const jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .populate('selected_worker_id', 'name phone'); // Populate worker details if assigned

        res.json({ success: true, data: jobs });

    } catch (error) {
        console.error('Get Tenant Jobs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch your jobs' });
    }
};

// Worker submits completion proof
exports.submitCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await Job.findById(id);

        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        // Security check: Only selected worker can submit proof
        if (job.selected_worker_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to submit completion for this job' });
        }

        if (job.status !== 'in_progress') {
            return res.status(400).json({ success: false, message: 'Only in-progress jobs can be completed' });
        }

        // Handle Completion Photos
        const completion_photos = [];
        if (req.files && req.files.length > 0) {
            const uploadPromises = req.files.map(file =>
                uploadOptimizedImage(file.buffer, `skillbridge/completion/${id}`)
            );
            const uploadResults = await Promise.all(uploadPromises);
            uploadResults.forEach(result => completion_photos.push(result.url));
        }

        job.status = 'reviewing';
        job.completion_photos = completion_photos;
        await job.save();

        // Notify Tenant
        await Notification.create({
            recipient: job.user_id,
            title: 'Job Finished - Pending Review',
            message: `Worker has submitted completion proof for: ${job.job_title}. Please review and confirm.`,
            type: 'completion_review',
            data: { jobId: job._id }
        });

        res.json({ success: true, message: 'Completion proof submitted. Waiting for tenant confirmation.', data: job });
    } catch (error) {
        logger.error('Submit Completion Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Tenant confirms completion
exports.confirmCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await Job.findById(id);

        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        // Security check: Only job owner can confirm
        if (job.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (job.status !== 'reviewing') {
            return res.status(400).json({ success: false, message: 'Job is not in reviewing state' });
        }

        job.status = 'completed';
        await job.save();

        // Notify Worker
        await Notification.create({
            recipient: job.selected_worker_id,
            title: 'Payment/Completion Confirmed',
            message: `The tenant has confirmed completion for: ${job.job_title}. Great job!`,
            type: 'job_completed',
            data: { jobId: job._id }
        });

        res.json({ success: true, message: 'Job marked as completed successfully', data: job });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
