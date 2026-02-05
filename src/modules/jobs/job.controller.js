const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');
const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
const { calculateDistance } = require('../../common/utils/geo');
const logger = require('../../config/logger');
const JobService = require('./job.service');

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

        const jobData = {
            job_title,
            job_description,
            material_requirements,
            skill_required,
            location,
            urgency_level,
            quotation_window_hours,
            issue_photos
        };

        // Delegate content creation and constraints to Service
        const job = await JobService.createJob(jobData, req.user);

        res.status(201).json({
            success: true,
            message: 'Job posted successfully',
            data: job
        });

    } catch (error) {
        logger.error('Create Job Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to post job'
        });
    }
};



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
        const jobs = await JobService.getWorkerFeed(req.user._id);

        // Enhance with hasSubmittedQuotation flag
        const Quotation = require('../quotations/quotation.model');
        const jobsWithFlags = await Promise.all(jobs.map(async (job) => {
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            return {
                ...job,
                hasSubmittedQuotation: !!existingQuotation
            };
        }));

        res.json({ success: true, data: jobsWithFlags });

    } catch (error) {
        if (error.code === 'WORKER_NOT_VERIFIED') {
            return res.status(403).json({
                success: false,
                message: error.message,
                errorCode: 'WORKER_NOT_VERIFIED'
            });
        }
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
// Start Job (Phase 4: Worker enters OTP)
exports.startJob = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;

        const job = await JobService.startJob(id, req.user._id, otp);

        res.json({ success: true, message: 'Job started successfully', data: job });

    } catch (error) {
        logger.error('Start Job Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to start job' });
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
        const job = await JobService.submitCompletion(id, req.user._id, req.files);
        res.json({ success: true, message: 'Completion proof submitted. Waiting for tenant confirmation.', data: job });
    } catch (error) {
        logger.error('Submit Completion Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to submit completion' });
    }
};

// Tenant confirms completion
exports.confirmCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.confirmCompletion(id, req.user._id);
        res.json({ success: true, message: 'Job marked as completed successfully', data: job });
    } catch (error) {
        logger.error('Confirm Completion Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to confirm completion' });
    }
};

