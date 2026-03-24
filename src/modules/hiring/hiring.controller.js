const HiringRequest = require('./hiring.model');
const Job = require('../jobs/job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Contractor = require('../contractors/contractor.model');
const notificationService = require('../notifications/notification.service');
const notifyHelper = require('../../common/notification.helper');
const logger = require('../../config/logger');

/**
 * Send Hiring Request (Contractor -> Worker)
 * @route   POST /api/hiring/request
 * @access  Private (Contractor)
 */
exports.createHireRequest = async (req, res) => {
    try {
        const { workerId, workerIds, projectId, proposedRate, message } = req.body;
        const contractorId = req.user._id;

        // Determine targets to support both bulk and single requests
        let targetList = [];
        if (workerIds && Array.isArray(workerIds)) {
             targetList = workerIds;
        } else if (workerId) {
             targetList = [workerId];
        }

        if (targetList.length === 0) {
             return res.status(400).json({ success: false, message: 'Please provide at least one worker ID.' });
        }

        // Verification Constraint: Unverified contractors cannot hire workers
        const contractor = await Contractor.findOne({ user: contractorId });
        if (!contractor || contractor.verificationStatus !== 'verified') {
            return res.status(403).json({ 
                success: false, 
                message: 'Your account must be verified by SkillBridge admin before you can hire workers. Please complete your profile and verification fields.' 
            });
        }

        // 1. Validate Project (must belong to contractor and be open)
        const project = await Job.findOne({ _id: projectId, user_id: contractorId });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Project not found or unauthorized' });
        }

        if (project.status !== 'open' && !project.is_contractor_project) {
            return res.status(400).json({ success: false, message: 'Only open projects can be used to hire workers' });
        }
        
        // Detailed check for contractor projects
        if (project.is_contractor_project && ['completed', 'cancelled', 'disputed'].includes(project.status)) {
            return res.status(400).json({ success: false, message: 'Cannot hire for a project that is already completed or cancelled' });
        }

        const { isWorkerAvailable } = require('../workers/worker.controller');

        let createdRequests = [];
        let errors = [];

        for (const currentWorkerId of targetList) {
             try {
                // Anti-Fraud: Prevent self-hiring
                if (currentWorkerId.toString() === contractorId.toString()) {
                    errors.push({ workerId: currentWorkerId, reason: 'Self-hiring is strictly prohibited.' });
                    continue;
                }

                // 2. Validate Worker (must exist as a User and have a Worker profile)
                let workerUser = await User.findById(currentWorkerId);
                let workerProfile;

                if (workerUser) {
                    workerProfile = await Worker.findOne({ user: workerUser._id });
                } else {
                    workerProfile = await Worker.findById(currentWorkerId).populate('user');
                    if (workerProfile) {
                        workerUser = workerProfile.user;
                    }
                }

                if (!workerUser || !workerProfile) {
                    errors.push({ workerId: currentWorkerId, reason: 'Worker not found' });
                    continue;
                }

                const targetWorkerIdObj = workerUser._id;

                // Hiring Constraint: Overlapping Jobs Check
                if (project.preferred_start_time) {
                    const available = await isWorkerAvailable(targetWorkerIdObj, project.preferred_start_time);
                    if (!available) {
                        errors.push({ workerId: currentWorkerId, reason: 'Worker has another job assigned at this time.' });
                        continue;
                    }
                }

                // 3. Prevent duplicate active requests for same project-worker pair
                const existingRequest = await HiringRequest.findOne({
                    worker: targetWorkerIdObj,
                    project: projectId,
                    status: 'pending'
                });

                if (existingRequest) {
                    errors.push({ workerId: currentWorkerId, reason: 'A pending hire request already exists for this worker.' });
                    continue;
                }

                // 4. Create Request
                const hiringRequest = await HiringRequest.create({
                    contractor: contractorId,
                    worker: targetWorkerIdObj,
                    project: projectId,
                    proposedRate,
                    message,
                    status: 'pending'
                });

                // 5. Send Notification (FCM + In-App) via Helper
                await notifyHelper.onHireRequestReceived(targetWorkerIdObj, project, req.user.name, proposedRate);

                createdRequests.push(hiringRequest);
             } catch (err) {
                 logger.error(`Error processing bulk hire request for ${currentWorkerId}:`, err);
                 errors.push({ workerId: currentWorkerId, reason: 'Internal error processing request.' });
             }
        }

        if (createdRequests.length === 0) {
             return res.status(400).json({
                 success: false,
                 message: 'Failed to send any hire requests.',
                 errors
             });
        }

        res.status(201).json({
            success: true,
            message: `Hire requests sent successfully to ${createdRequests.length} worker(s).`,
            data: createdRequests,
            errors: errors.length > 0 ? errors : undefined
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

        const hiringRequest = await HiringRequest.findById(requestId)
            .populate('project')
            .populate('contractor', 'name')
            .session(session);

        if (!hiringRequest) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Hire request not found' });
        }

        // Security: Ensure this worker is the one authorized to respond
        const workerProfile = await Worker.findOne({ user: workerId });
        const isAuthorized = hiringRequest.worker.toString() === workerId.toString() || 
                           (workerProfile && hiringRequest.worker.toString() === workerProfile._id.toString());

        if (!isAuthorized) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({ success: false, message: 'Not authorized to respond to this request' });
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
            const isProjectHiring = project && (project.status === 'open' || (project.is_contractor_project && ['assigned', 'in_progress', 'eta_confirmed'].includes(project.status)));
            
            if (!isProjectHiring) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ 
                    success: false, 
                    message: 'Project is no longer open for hiring or has already been finalized.' 
                });
            }

            // PHASE 3: Strict state transition check
            project.status = 'assigned';
            
            // For contractor projects, we may have multiple workers, so we don't necessarily 
            // overwrite selected_worker_id if it's already set, but we usually set the first one as primary.
            if (!project.selected_worker_id) {
                project.selected_worker_id = workerId;
            }

            project.timeline.push({
                status: 'assigned',
                timestamp: new Date(),
                actor: 'worker',
                note: `Worker accepted hire request from ${hiringRequest.contractor.name}`
            });
            await project.save({ session });

            // Only cancel other requests if it's NOT a contractor project
            // Contractor projects support multiple workers.
            if (!project.is_contractor_project) {
                await HiringRequest.updateMany(
                    { project: project._id, status: 'pending', _id: { $ne: requestId } },
                    { status: 'expired' },
                    { session }
                );
            }
        }

        // Commit transaction before notifications (side effects)
        await session.commitTransaction();
        session.endSession();

        // Notify Contractor (FCM + In-App) via Helper
        await notifyHelper.onHireRequestResponded(hiringRequest.contractor._id, hiringRequest.project, req.user.name, status);

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

/**
 * Get Worker Hire Requests
 * @route   GET /api/hiring/requests
 * @access  Private (Worker)
 */
exports.getWorkerRequests = async (req, res) => {
    try {
        const userId = req.user._id;
        const workerProfile = await Worker.findOne({ user: userId });
        
        const requests = await HiringRequest.find({ 
            $or: [
                { worker: userId },
                { worker: workerProfile ? workerProfile._id : null }
            ]
        })
            .populate('project', 'job_title skill_required location budget')
            .populate('contractor', 'name profileImage')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        logger.error('Get Worker Hire Requests Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch hire requests' });
    }
};
