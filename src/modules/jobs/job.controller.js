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
// Worker confirms arrival (Replaces startJob)
// Worker confirms arrival (Replaces startJob)
exports.confirmArrival = async (req, res) => {
    try {
        const { id } = req.params;
        let { location } = req.body;
        // Handle potential string location if multi-part (unlikely here but safe)
        if (typeof location === 'string') {
            try { location = JSON.parse(location); } catch (e) { }
        }

        const job = await JobService.confirmArrival(id, req.user._id, location);
        res.json({ success: true, message: 'Arrival confirmed', data: job });
    } catch (error) {
        logger.error('Confirm Arrival Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Diagnosis Mode
exports.submitDiagnosis = async (req, res) => {
    try {
        const { id } = req.params;
        const diagnosisData = req.body; // materials, final_labor_cost, etc.
        const job = await JobService.submitDiagnosis(id, req.user._id, diagnosisData);
        res.json({ success: true, message: 'Diagnosis submitted', data: job });
    } catch (error) {
        logger.error('Submit Diagnosis Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.approveDiagnosis = async (req, res) => {
    try {
        const { id } = req.params;
        const { approved, rejectionReason } = req.body;
        const job = await JobService.approveDiagnosis(id, req.user._id, approved, rejectionReason);
        res.json({ success: true, message: approved ? 'Diagnosis approved, job started' : 'Diagnosis rejected', data: job });
    } catch (error) {
        logger.error('Approve Diagnosis Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Material Requests
exports.requestMaterial = async (req, res) => {
    try {
        const { id } = req.params;
        const requestData = req.body; // item_name, cost, reason, bill_proof (url)
        // If file uploaded logic needed, handle here similar to completion
        const job = await JobService.requestMaterial(id, req.user._id, requestData);
        res.json({ success: true, message: 'Material requested', data: job });
    } catch (error) {
        logger.error('Request Material Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.respondToMaterial = async (req, res) => {
    try {
        const { id, requestId } = req.params;
        const { approved } = req.body;
        const job = await JobService.respondToMaterial(id, req.user._id, requestId, approved);
        res.json({ success: true, message: 'Material response recorded', data: job });
    } catch (error) {
        logger.error('Respond Material Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
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

// Tenant confirms completion (Starts Cooling Window)
exports.confirmCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.confirmCompletion(id, req.user._id);
        res.json({ success: true, message: 'Work accepted. Cooling period started.', data: job });
    } catch (error) {
        logger.error('Confirm Completion Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to confirm completion' });
    }
};

// Finalize (Post Cooling)
exports.finalizeJob = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.finalizeJob(id); // Usually triggered by system, but maybe admin/user manual trigger
        res.json({ success: true, message: 'Job finalized and payment released', data: job });
    } catch (error) {
        logger.error('Finalize Job Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Disputes
exports.raiseDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const job = await JobService.raiseDispute(id, req.user._id, reason);
        res.json({ success: true, message: 'Dispute raised', data: job });
    } catch (error) {
        logger.error('Raise Dispute Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.resolveDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { decision, notes } = req.body; // admin only
        const job = await JobService.resolveDispute(id, req.user._id, decision, notes);
        res.json({ success: true, message: 'Dispute resolved', data: job });
    } catch (error) {
        logger.error('Resolve Dispute Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all unique job categories (skills)
exports.getJobCategories = async (req, res) => {
    try {
        // Fetch distinct 'skill_required' from the Job collection
        const categories = await Job.distinct('skill_required');

        // Return the list of categories
        res.json({
            success: true,
            data: categories.filter(c => c) // Filter out null/undefined
        });
    } catch (error) {
        logger.error('Get Job Categories Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
};

