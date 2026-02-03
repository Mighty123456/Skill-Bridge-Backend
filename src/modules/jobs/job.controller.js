const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');
const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
const { calculateDistance } = require('../../common/utils/geo');
const logger = require('../../config/logger');

// Create a new job
exports.createJob = async (req, res) => {
    try {
        let { job_title, job_description, material_requirements, skill_required, location, urgency_level, quotation_window_hours } = req.body;

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
            material_requirements,
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

        // Check if current user is the Job Owner (Tenant)
        let start_otp = undefined;
        if (req.user && job.user_id._id.toString() === req.user._id.toString()) {
            // Need to explicitly fetch the hidden OTP field
            const jobWithOtp = await Job.findById(req.params.id).select('+start_otp');
            if (jobWithOtp) {
                start_otp = jobWithOtp.start_otp;
            }
        }

        res.json({
            success: true,
            data: {
                ...job._doc,
                hasSubmittedQuotation,
                start_otp // Will be undefined for non-owners
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

        const maxDistance = 50000; // 50km

        if (workerUser && workerUser.location && workerUser.location.coordinates && workerUser.location.coordinates.length === 2) {
            query['location'] = {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: workerUser.location.coordinates
                    },
                    $maxDistance: maxDistance
                }
            };
        } else {
            console.log('Worker location not available for proximity search, returning all matching skills');
        }

        let jobs = await Job.find(query).limit(50); // Get more candidates for AI ranking

        // 3. AI Ranking & Recommendation Engine
        // Factors: Distance (40%), Urgency (30%), Skill Confidence (20%), Quotation Window Remaining (10%)

        let rankedJobs = [];
        const now = new Date();

        if (workerUser && workerUser.location && workerUser.location.coordinates) {
            const userLng = workerUser.location.coordinates[0];
            const userLat = workerUser.location.coordinates[1];

            rankedJobs = jobs.map(job => {
                const jobDoc = job.toObject();

                // A. Distance Score (Closer is better)
                let distanceKm = 0;
                if (job.location && job.location.coordinates) {
                    distanceKm = calculateDistance(userLat, userLng, job.location.coordinates[1], job.location.coordinates[0]);
                }
                const distanceScore = Math.max(0, 100 - (distanceKm * 2)); // 50km = 0 score, 0km = 100 score

                // B. Urgency Score
                const urgencyScore = job.is_emergency ? 100 : (job.urgency_level === 'high' ? 70 : 30);

                // C. Skill Confidence Score (from Worker Passport)
                const skillStat = workerProfile.skill_stats ? workerProfile.skill_stats.find(s => s.skill === job.skill_required) : null;
                const confidenceScore = skillStat ? skillStat.confidence : 50; // Default 50

                // D. Calculate Weighted "Match Score"
                // Weights: Dist (0.4), Urgency (0.3), Confidence (0.2), Random/Newness (0.1)
                const matchScore = (distanceScore * 0.4) + (urgencyScore * 0.3) + (confidenceScore * 0.2) + (10); // Base +10

                // E. Availability Prediction / Warning
                // If the job is urgent, mark it clearly

                return {
                    ...jobDoc,
                    distanceKm: parseFloat(distanceKm.toFixed(1)),
                    matchScore: Math.round(matchScore),
                    aiLabel: matchScore > 80 ? 'Top Match' : (job.is_emergency ? 'Emergency' : null)
                };
            });

            // Sort by AI Match Score
            rankedJobs.sort((a, b) => b.matchScore - a.matchScore);

        } else {
            rankedJobs = jobs.map(j => ({ ...j.toObject(), matchScore: 0 }));
        }

        // Limit to top 20 after ranking
        const finalJobs = rankedJobs.slice(0, 20);

        // Enhance with hasSubmittedQuotation flag
        const Quotation = require('../quotations/quotation.model');
        const jobsWithFlags = await Promise.all(finalJobs.map(async (job) => {
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            return {
                ...job,
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
            .populate('user_id', 'name phone address profileImage');

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
            .populate('selected_worker_id', 'name phone profileImage'); // Populate worker details if assigned

        res.json({ success: true, data: jobs });

    } catch (error) {
        console.error('Get Tenant Jobs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch your jobs' });
    }
};

// Start Job (Phase 4: Worker enters OTP)
exports.startJob = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;

        // Select start_otp explicitly as it is hidden
        const job = await Job.findById(id).select('+start_otp');
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        // Phase 3 sets status to 'assigned', Phase 4 transitions to 'in_progress'
        if (job.status === 'in_progress') {
            return res.status(400).json({ success: false, message: 'Job already started' });
        }

        if (job.status !== 'assigned') {
            return res.status(400).json({ success: false, message: 'Job is not ready to start (must be assigned first)' });
        }

        if (job.start_otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP. Please ask the customer for the correct code.' });
        }

        job.started_at = new Date();
        job.status = 'in_progress';
        await job.save();

        // Notify Customer
        await Notification.create({
            recipient: job.user_id,
            title: 'Job Started',
            message: `Worker has started the job: ${job.job_title}`,
            type: 'job_started',
            data: { jobId: job._id }
        });

        res.json({ success: true, message: 'Job started successfully', data: job });

    } catch (error) {
        logger.error('Start Job Error:', error);
        res.status(500).json({ success: false, message: 'Failed to start job' });
    }
};

// Aliases for route consistency if needed, but we already have submitCompletion
// Aliases for route consistency if needed, but we already have submitCompletion
exports.submitCompletion = exports.submitCompletion; // Ensure direct access
exports.completeJob = async (req, res) => {
    return exports.submitCompletion(req, res);
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

        // Update Worker Skill Stats (Global Passport Update)
        try {
            const worker = await Worker.findOne({ user: job.selected_worker_id });
            if (worker) {
                // Check if skill_stats exists
                if (!worker.skill_stats) worker.skill_stats = [];

                const skillIndex = worker.skill_stats.findIndex(s => s.skill === job.skill_required);

                if (skillIndex > -1) {
                    // Update existing stat
                    worker.skill_stats[skillIndex].last_used = new Date();
                    worker.skill_stats[skillIndex].confidence = Math.min(100, worker.skill_stats[skillIndex].confidence + 2); // Boost confidence
                    worker.skill_stats[skillIndex].decay_warning_sent = false; // Reset warning
                } else {
                    // Add new stat if not present (should match skills array)
                    worker.skill_stats.push({
                        skill: job.skill_required,
                        confidence: 100,
                        last_used: new Date(),
                        decay_warning_sent: false
                    });
                    // Ensure it's in the main skills list too
                    if (!worker.skills.includes(job.skill_required)) {
                        worker.skills.push(job.skill_required);
                    }
                }
                await worker.save();
                logger.info(`Updated skill stats for worker ${worker._id} - Skill: ${job.skill_required}`);
            }
        } catch (err) {
            logger.error(`Failed to update worker stats: ${err.message}`);
            // Don't fail the request, just log it
        }

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

