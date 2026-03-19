const Job = require('../jobs/job.model');
const Wallet = require('../wallet/wallet.model');
const User = require('../users/user.model');
const Contractor = require('./contractor.model');
const JobService = require('../jobs/job.service');
const notifyHelper = require('../../common/notification.helper');
const logger = require('../../config/logger');

/**
 * Get Contractor Projects (is_contractor_project = true)
 * @route   GET /api/v1/contractors/projects
 * @access  Private (Contractor)
 */
exports.getContractorProjects = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { status, archived, all } = req.query;

        const query = {
            user_id: contractorId,
            is_contractor_project: true,
        };

        if (all === 'true') {
            // No status filter - return all projects
        } else if (archived === 'true') {
            query.status = { $in: ['completed', 'cancelled'] };
        } else if (status) {
            // Support comma-separated status values
            const statusList = status.split(',');
            query.status = statusList.length > 1 ? { $in: statusList } : statusList[0];
        } else {
            // Default: all non-archived
            query.status = { $nin: ['completed', 'cancelled'] };
        }

        const jobs = await Job.find(query)
            .sort({ created_at: -1 })
            .populate('selected_worker_id', 'name phone profileImage');

        res.status(200).json({
            success: true,
            count: jobs.length,
            data: jobs
        });
    } catch (error) {
        logger.error('Get Contractor Projects Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contractor projects'
        });
    }
};



/**
 * Internal Helper: Check if worker has any tasks overlapping a specific date range
 */
const isWorkerAvailable = async (workerId, startDate, endDate, excludeTaskId = null) => {
    if (!workerId) return true;
    
    // Normalize date to start and end of day in UTC to ensure consistency
    const sDate = new Date(startDate);
    const eDate = new Date(endDate || startDate);
    
    const queryStart = new Date(Date.UTC(sDate.getUTCFullYear(), sDate.getUTCMonth(), sDate.getUTCDate(), 0, 0, 0, 0));
    const queryEnd = new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), eDate.getUTCDate(), 23, 59, 59, 999));

    const existingJobsWithConflicts = await Job.find({
        "tasks.assigned_worker_id": workerId,
        $or: [
            { "tasks.due_date": { $gte: queryStart, $lte: queryEnd } },
            { 
               "tasks.start_date": { $lte: queryEnd },
               "tasks.end_date": { $gte: queryStart }
            }
        ]
    });

    for (const job of existingJobsWithConflicts) {
        for (const task of job.tasks) {
            if (task.assigned_worker_id?.toString() === workerId.toString()) {
                
                // If we are updating a task, exclude it from conflict check
                if (excludeTaskId && task._id.toString() === excludeTaskId.toString()) {
                    continue;
                }

                // Check overlap logic
                const tStart = task.start_date || task.due_date;
                const tEnd = task.end_date || task.due_date;

                if (tStart && tEnd) {
                    if (tStart <= queryEnd && tEnd >= queryStart) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
};

/**
 * Get Contractor Dashboard Stats
 * @route   GET /api/v1/contractors/dashboard/stats
 * @access  Private (Contractor)
 */
exports.getDashboardStats = async (req, res) => {
    try {
        const contractorId = req.user._id;

        // 1. Calculate Active Projects
        const activeProjectStatuses = [
            'open', 'assigned', 'eta_confirmed', 'on_the_way', 
            'arrived', 'diagnosis_mode', 'diagnosed', 
            'material_pending_approval', 'in_progress', 'reviewing'
        ];
        
        const activeProjectsCount = await Job.countDocuments({
            user_id: contractorId,
            status: { $in: activeProjectStatuses }
        });

        // 2. Calculate Completed Projects
        const completedProjectsCount = await Job.countDocuments({
            user_id: contractorId,
            status: 'completed'
        });

        // 3. Calculate Total Workers Hired
        const uniqueWorkers = await Job.distinct('selected_worker_id', {
            user_id: contractorId,
            selected_worker_id: { $ne: null }
        });
        const totalWorkersCount = uniqueWorkers.length;

        // 4. Calculate Total Earnings & Pending from Wallet
        let wallet = await Wallet.findOne({ user: contractorId });
        
        res.status(200).json({
            success: true,
            data: {
                activeProjects: activeProjectsCount || 0,
                completedProjects: completedProjectsCount || 0,
                totalWorkers: totalWorkersCount || 0,
                totalEarnings: wallet ? wallet.balance : 0,
                pendingPayments: wallet ? wallet.pendingBalance : 0
            }
        });
    } catch (error) {
        logger.error('Get Contractor Dashboard Stats Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch dashboard statistics'
        });
    }
};

/**
 * Get Contractor Workers
 * @route   GET /api/v1/contractors/workers
 * @access  Private (Contractor)
 */
exports.getContractorWorkers = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const Worker = require('../workers/worker.model');

        // Get all unique workers that have worked for this contractor
        const uniqueWorkerIds = await Job.distinct('selected_worker_id', {
            user_id: contractorId,
            selected_worker_id: { $ne: null }
        });

        // Fetch the detailed worker profiles from Worker collection
        const workerProfiles = await Worker.find({
            user: { $in: uniqueWorkerIds }
        }).populate('user', 'name email phone profileImage isOnline location isVerified');

        // Map to flat structure expected by mobile frontend
        // id is used for identifying the person in project assignments & chats (User ID)
        // workerProfileId is used for profile-specific lookups (Ratings, Badges)
        const workers = workerProfiles.map(profile => {
            const user = profile.user || {};
            return {
                id: user._id, // User ID is the primary ID for hiring/chatting
                workerProfileId: profile._id, // Keep Profile ID for ratings etc
                userId: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                profileImage: user.profileImage,
                skills: profile.skills,
                experience: profile.experience,
                isVerified: user.isVerified || profile.verificationStatus === 'verified',
                isOnline: user.isOnline,
                location: user.location
            };
        });

        res.status(200).json({
            success: true,
            count: workers.length,
            data: workers
        });
    } catch (error) {
        logger.error('Get Contractor Workers Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch hired workers'
        });
    }
};
/**
 * Add Task to Job/Project
 * @route   POST /api/v1/contractors/schedule/task
 */
exports.addTaskToJob = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { jobId, title, description, assigned_worker_id, assigned_worker_name, due_date, start_date, end_date } = req.body;

        const job = await Job.findOne({ _id: jobId, user_id: contractorId });
        if (!job) return res.status(404).json({ success: false, message: 'Job not found or unauthorized' });

        const sDate = start_date || due_date;
        const eDate = end_date || due_date;

        // Phase 4 Constraint: Prevent double booking
        const available = await isWorkerAvailable(assigned_worker_id, sDate, eDate);
        if (!available) {
            return res.status(400).json({ 
                success: false, 
                message: `Worker ${assigned_worker_name} is already booked during this time.` 
            });
        }

        const newTask = {
            title,
            description,
            status: 'pending',
            assigned_worker_id,
            assigned_worker_name,
            due_date: new Date(due_date || eDate),
            start_date: sDate ? new Date(sDate) : undefined,
            end_date: eDate ? new Date(eDate) : undefined
        };

        job.tasks.push(newTask);
        
        // Phase 12 Enhancement: Auto-transition status when first worker assigned
        if (job.status === 'open' && assigned_worker_id) {
            job.status = 'assigned';
        }
        // Phase 4 Constraint: Log schedule updates
        JobService.appendTimeline(
            job, 
            job.status, 
            'user', 
            `Scheduled new task: "${title}" assigned to ${assigned_worker_name} for ${new Date(due_date).toDateString()}`
        );

        await job.save();

        // Notify Worker if assigned
        if (assigned_worker_id) {
            await notifyHelper.onProjectTaskAssigned(assigned_worker_id, job.job_title, title, due_date);
        }

        res.status(201).json({
            success: true,
            data: job.tasks[job.tasks.length - 1]
        });
    } catch (error) {
        logger.error('Add Task To Job Error:', error);
        res.status(500).json({ success: false, message: 'Failed to add task' });
    }
};

/**
 * Update Task in Job/Project
 * @route   PUT /api/v1/contractors/schedule/task/:jobId/:taskId
 */
exports.updateTask = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { jobId, taskId } = req.params;
        const updateData = req.body;

        const job = await Job.findOne({ _id: jobId, user_id: contractorId });
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const task = job.tasks.id(taskId);
        if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

        // Phase 4 Constraint: Check availability if date or worker changes
        const newWorkerId = updateData.assigned_worker_id || task.assigned_worker_id;
        const newStartDate = updateData.start_date || updateData.due_date || task.start_date || task.due_date;
        const newEndDate = updateData.end_date || updateData.due_date || task.end_date || task.due_date;

        if (updateData.assigned_worker_id || updateData.due_date || updateData.start_date || updateData.end_date) {
            const available = await isWorkerAvailable(newWorkerId, newStartDate, newEndDate, taskId);
            if (!available) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Worker is already booked for this date on another task." 
                });
            }
        }

        const oldTitle = task.title;
        if (updateData.title) task.title = updateData.title;
        if (updateData.description) task.description = updateData.description;
        if (updateData.status) task.status = updateData.status;
        if (updateData.assigned_worker_id) task.assigned_worker_id = updateData.assigned_worker_id;
        if (updateData.assigned_worker_name) task.assigned_worker_name = updateData.assigned_worker_name;
        if (updateData.due_date) task.due_date = new Date(updateData.due_date);
        if (updateData.start_date) task.start_date = new Date(updateData.start_date);
        if (updateData.end_date) task.end_date = new Date(updateData.end_date);

        // Phase 4 Constraint: Log schedule updates
        JobService.appendTimeline(
            job, 
            job.status, 
            'user', 
            `Updated task "${oldTitle}": ${updateData.status ? 'Status changed to ' + updateData.status : 'Schedule modified'}`
        );

        // Phase 12 Enhancement: Auto-transition status when worker is assigned
        if (job.status === 'open' && (updateData.assigned_worker_id || task.assigned_worker_id)) {
            job.status = 'assigned';
        }

        await job.save();

        // Notify Worker if assignment changed or updated
        if (updateData.assigned_worker_id) {
            await notifyHelper.onProjectTaskAssigned(
                updateData.assigned_worker_id, 
                job.job_title, 
                updateData.title || task.title, 
                updateData.due_date || task.due_date
            );
        }

        res.status(200).json({
            success: true,
            data: task
        });
    } catch (error) {
        logger.error('Update Task Error:', error);
        res.status(500).json({ success: false, message: 'Failed to update task' });
    }
};

/**
 * Get Workforce Schedule
 * @route   GET /api/v1/contractors/schedule
 */
exports.getWorkforceSchedule = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const jobs = await Job.find({ user_id: contractorId });

        // Map to structure expected by mobile frontend
        // Note: Mobile frontend uses ContractorProject.fromJobJson normally.
        // We'll need to return jobs which will be converted to ContractorProject in frontend.
        res.status(200).json({
            success: true,
            data: jobs
        });
    } catch (error) {
        logger.error('Get Workforce Schedule Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch schedule' });
    }
};

/**
 * Check Worker Availability
 * @route   GET /api/v1/contractors/schedule/availability/:workerId/:date
 */
exports.checkAvailability = async (req, res) => {
    try {
        const { workerId, date } = req.params;
        const endDateStr = req.query.endDate || date;
        
        // Phase 4 Constraint: Use UTC for consistency
        const sDate = new Date(date);
        const eDate = new Date(endDateStr);

        const startOfDay = new Date(Date.UTC(sDate.getUTCFullYear(), sDate.getUTCMonth(), sDate.getUTCDate(), 0, 0, 0, 0));
        const endOfDay = new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), eDate.getUTCDate(), 23, 59, 59, 999));

        const existingTasks = await Job.find({
            tasks: {
                $elemMatch: {
                    assigned_worker_id: workerId,
                    $or: [
                        { due_date: { $gte: startOfDay, $lte: endOfDay } },
                        { 
                           start_date: { $lte: endOfDay },
                           end_date: { $gte: startOfDay }
                        }
                    ]
                }
            }
        });

        const dayTasks = [];
        existingTasks.forEach(job => {
            job.tasks.forEach(task => {
                if (task.assigned_worker_id?.toString() === workerId) {
                    const tStart = task.start_date || task.due_date;
                    const tEnd = task.end_date || task.due_date;
                    if (tStart && tEnd && tStart <= endOfDay && tEnd >= startOfDay) {
                        dayTasks.push({
                            jobId: job._id,
                            taskId: task._id,
                            jobTitle: job.job_title,
                            taskTitle: task.title
                        });
                    }
                }
            });
        });

        res.status(200).json({
            success: true,
            isAvailable: dayTasks.length === 0,
            conflicts: dayTasks
        });
    } catch (error) {
        logger.error('Check Availability Error:', error);
        res.status(500).json({ success: false, message: 'Failed to check availability' });
    }
};

/**
 * Delete Task from Job/Project
 * @route   DELETE /api/v1/contractors/schedule/task/:jobId/:taskId
 */
exports.deleteTask = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { jobId, taskId } = req.params;

        const job = await Job.findOne({ _id: jobId, user_id: contractorId });
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        const task = job.tasks.id(taskId);
        if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

        const taskTitle = task.title;
        job.tasks.pull(taskId);

        // Phase 4 Constraint: Log schedule updates
        JobService.appendTimeline(
            job, 
            job.status, 
            'user', 
            `Removed scheduled task: "${taskTitle}"`
        );

        await job.save();

        res.status(200).json({
            success: true,
            message: 'Task removed successfully'
        });
    } catch (error) {
        logger.error('Delete Task Error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete task' });
    }
};

/**
 * Update Project Status (Archive/Finalize)
 * @route   PATCH /api/v1/contractors/projects/:id/status
 * @access  Private (Contractor)
 */
exports.updateProjectStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const contractorId = req.user._id;

        const job = await Job.findOne({ _id: id, user_id: contractorId });
        if (!job) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        job.status = status;
        await job.save();

        res.status(200).json({
            success: true,
            message: `Project status updated to ${status}`,
            data: job
        });
    } catch (error) {
        logger.error('Update Project Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update project status'
        });
    }
};
