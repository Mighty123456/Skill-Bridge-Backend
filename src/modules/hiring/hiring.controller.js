const HiringRequest = require('./hiring.model');
const Job = require('../jobs/job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Contractor = require('../contractors/contractor.model');
const notificationService = require('../notifications/notification.service');
const logger = require('../../config/logger');

/**
 * Send Hiring Request (Contractor -> Worker)
 * @route   POST /api/hiring/request
 * @access  Private (Contractor)
 */
exports.createHireRequest = async (req, res) => {
    try {
        const { workerId, projectId, proposedRate, message } = req.body;
        const contractorId = req.user._id;

        // Verification Constraint: Unverified contractors cannot hire workers
        const contractor = await Contractor.findOne({ user: contractorId });
        if (!contractor || contractor.verificationStatus !== 'verified') {
            return res.status(403).json({ 
                success: false, 
                message: 'Your account must be verified by SkillBridge admin before you can hire workers. Please complete your profile and verification fields.' 
            });
        }

        // Anti-Fraud: Prevent self-hiring
        if (workerId.toString() === contractorId.toString()) {
            return res.status(400).json({ success: false, message: 'Self-hiring is strictly prohibited.' });
        }

        // 1. Validate Project (must belong to contractor and be open)
        const project = await Job.findOne({ _id: projectId, user_id: contractorId });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found or unauthorized' });
        }

        if (project.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Only open projects can be used to hire workers' });
        }

        // 2. Validate Worker (must exist as a User and have a Worker profile)
        let workerUser = await User.findById(workerId);
        let workerProfile;

        if (workerUser) {
            workerProfile = await Worker.findOne({ user: workerUser._id });
        } else {
            // If not found by User ID, try finding by Worker ID
            workerProfile = await Worker.findById(workerId).populate('user');
            if (workerProfile) {
                workerUser = workerProfile.user;
            }
        }

        if (!workerUser || !workerProfile) {
            return res.status(404).json({ success: false, message: 'Worker not found' });
        }

        // Use the actual User ID for the rest of the logic
        const targetWorkerId = workerUser._id;

        // Hiring Constraint: Overlapping Jobs Check
        // We check if worker is available for project's preferred start time
        const { isWorkerAvailable } = require('../workers/worker.controller');
        if (project.preferred_start_time) {
            const available = await isWorkerAvailable(targetWorkerId, project.preferred_start_time);
            if (!available) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Worker has another job assigned at this time. Please choose another worker or time.' 
                });
            }
        }

        // 3. Prevent duplicate active requests for same project-worker pair
        const existingRequest = await HiringRequest.findOne({
            worker: targetWorkerId,
            project: projectId,
            status: 'pending'
        });

        if (existingRequest) {
            return res.status(400).json({ success: false, message: 'A pending hire request already exists for this worker on this project' });
        }

        // 4. Create Request
        const hiringRequest = await HiringRequest.create({
            contractor: contractorId,
            worker: targetWorkerId,
            project: projectId,
            proposedRate,
            message,
            status: 'pending'
        });

        // 5. Send Notification to Worker
        await notificationService.createNotification({
            recipient: targetWorkerId,
            title: '💼 New Hire Request!',
            message: `${req.user.name} wants to hire you for '${project.job_title}' at ₹${proposedRate}/hr.`,
            type: 'hire_request',
            data: {
                requestId: hiringRequest._id,
                projectId: project._id,
                contractorName: req.user.name,
                proposedRate: proposedRate,
                jobTitle: project.job_title
            }
        });

        res.status(201).json({
            success: true,
            message: 'Hire request sent successfully',
            data: hiringRequest
        });

    } catch (error) {
        logger.error('Create Hire Request Error:', error);
        res.status(500).json({ success: false, message: 'Failed to send hire request' });
    }
};

const mongoose = require('mongoose');

/**
 * Respond to Hiring Request (Worker -> Accept/Reject)
 * @route   POST /api/hiring/respond
 * @access  Private (Worker)
 */
exports.respondToHireRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { requestId, status, message } = req.body;
        const workerId = req.user._id;

        if (!['accepted', 'rejected'].includes(status)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Invalid status response' });
        }

        const hiringRequest = await HiringRequest.findOne({ _id: requestId, worker: workerId })
            .populate('project')
            .populate('contractor', 'name')
            .session(session);

        if (!hiringRequest) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Hire request not found' });
        }

        if (hiringRequest.status !== 'pending') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: `Request is already ${hiringRequest.status}` });
        }

        // Update Request
        hiringRequest.status = status;
        hiringRequest.respondedAt = new Date();
        await hiringRequest.save({ session });

        // If accepted, update the Job record
        if (status === 'accepted') {
            const project = await Job.findById(hiringRequest.project._id).session(session);
            if (!project || project.status !== 'open') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Project is no longer open for hiring or has already been assigned.' 
                });
            }

            // PHASE 3: Strict state transition check
            project.status = 'assigned';
            project.selected_worker_id = workerId;
            project.timeline.push({
                status: 'assigned',
                timestamp: new Date(),
                actor: 'worker',
                note: `Worker accepted hire request from ${hiringRequest.contractor.name}`
            });
            await project.save({ session });

            // Cancel any other pending hire requests for this project
            await HiringRequest.updateMany(
                { project: project._id, status: 'pending', _id: { $ne: requestId } },
                { status: 'expired' },
                { session }
            );
        }

        // Commit transaction before notifications (side effects)
        await session.commitTransaction();
        session.endSession();

        // Notify Contractor
        await notificationService.createNotification({
            recipient: hiringRequest.contractor._id,
            title: status === 'accepted' ? '✅ Hire Request Accepted!' : '❌ Hire Request Rejected',
            message: `${req.user.name} has ${status} your hire request for '${hiringRequest.project.job_title}'.`,
            type: 'hire_response',
            data: {
                requestId: hiringRequest._id,
                projectId: hiringRequest.project._id,
                status: status,
                workerName: req.user.name
            }
        });

        res.status(200).json({
            success: true,
            message: `Hire request ${status} successfully`,
            data: hiringRequest
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        logger.error('Respond to Hire Request Error:', error);
        res.status(500).json({ success: false, message: 'Failed to respond to hire request' });
    }
};
