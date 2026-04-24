const Job = require('../jobs/job.model');
const Wallet = require('../wallet/wallet.model');
const User = require('../users/user.model');
const Contractor = require('./contractor.model');
const WorkforcePool = require('./workforce-pool.model');
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
    
    // Use precise times if provided, otherwise assume full day (UTC)
    const queryStart = new Date(startDate);
    const queryEnd = new Date(endDate || startDate);

    // If both are exact same (e.g. 12:00 to 12:00), treat as full day
    const isFullDay = queryStart.getTime() === queryEnd.getTime();
    
    let dbStart, dbEnd;
    if (isFullDay) {
        dbStart = new Date(Date.UTC(queryStart.getUTCFullYear(), queryStart.getUTCMonth(), queryStart.getUTCDate(), 0, 0, 0, 0));
        dbEnd = new Date(Date.UTC(queryStart.getUTCFullYear(), queryStart.getUTCMonth(), queryStart.getUTCDate(), 23, 59, 59, 999));
    } else {
        dbStart = queryStart;
        dbEnd = queryEnd;
    }

    const existingJobsWithConflicts = await Job.find({
        "tasks.assigned_worker_id": workerId,
        $or: [
            { "tasks.due_date": { $gte: dbStart, $lte: dbEnd } },
            { 
               "tasks.start_date": { $lte: dbEnd },
               "tasks.end_date": { $gte: dbStart }
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

                // Check overlap logic: (TaskStart < QueryEnd && TaskEnd > QueryStart)
                const tStart = task.start_date || task.due_date;
                const tEnd = task.end_date || task.due_date;

                if (tStart && tEnd) {
                    if (tStart < dbEnd && tEnd > dbStart) {
                        return false;
                    }
                }
            }
        }
    }
    return true;
};

/**
 * Get Detailed Reports & Analytics for Contractor
 * @route   GET /api/v1/contractors/reports/analytics
 * @access  Private (Contractor)
 */
exports.getDetailedReports = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const Payment = require('../payments/payment.model');
        const Job = require('../jobs/job.model');
        const mongoose = require('mongoose');

        // 1. Monthly Spending Trend (Last 6 Months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const spendingTrend = await Payment.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(contractorId),
                    type: { $in: ['escrow', 'payout', 'topup'] },
                    status: 'completed',
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: "$createdAt" },
                        month: { $month: "$createdAt" }
                    },
                    total: { $sum: "$amount" }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        // 2. Project Status Distribution
        const statusDistribution = await Job.aggregate([
            { $match: { user_id: new mongoose.Types.ObjectId(contractorId) } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        // 3. Top Workers by Spending
        const topWorkers = await Payment.aggregate([
            {
                $match: {
                    user: new mongoose.Types.ObjectId(contractorId),
                    worker: { $ne: null },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: "$worker",
                    totalSpent: { $sum: "$amount" },
                    jobCount: { $sum: 1 }
                }
            },
            { $sort: { totalSpent: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'workerInfo'
                }
            },
            { $unwind: "$workerInfo" },
            {
                $project: {
                    workerId: "$_id",
                    name: "$workerInfo.name",
                    profileImage: "$workerInfo.profileImage",
                    totalSpent: 1,
                    jobCount: 1
                }
            }
        ]);

        // 4. Category-wise Budget Allocation
        const categorySpending = await Job.aggregate([
            { $match: { user_id: new mongoose.Types.ObjectId(contractorId) } },
            {
                $group: {
                    _id: "$category",
                    totalBudget: { $sum: "$budget" },
                    projectCount: { $sum: 1 }
                }
            },
            { $sort: { totalBudget: -1 } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                financialTrend: spendingTrend.map(item => ({
                    month: `${item._id.month}/${item._id.year}`,
                    amount: item.total
                })),
                statusDistribution: statusDistribution.reduce((acc, curr) => {
                    acc[curr._id] = curr.count;
                    return acc;
                }, {}),
                topWorkers,
                categorySpending: categorySpending.map(item => ({
                    category: item._id || 'Uncategorized',
                    amount: item.totalBudget,
                    count: item.projectCount
                }))
            }
        });
    } catch (error) {
        logger.error('Get Detailed Reports Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate statistics report'
        });
    }
};

/**
 * Get Contractor Dashboard Stats
 * @route   GET /api/v1/contractors/dashboard/stats
 * @access  Private (Contractor)
 */
exports.getDashboardStats = async (req, res) => {
    try {
        const contractorId = req.user._id;

        // 1. Calculate Project Counts
        const activeProjectStatuses = [
            'open', 'assigned', 'eta_confirmed', 'on_the_way', 
            'arrived', 'diagnosis_mode', 'diagnosed', 
            'material_pending_approval', 'in_progress', 'reviewing'
        ];
        const activeProjectsCount = await Job.countDocuments({
            user_id: contractorId,
            status: { $in: activeProjectStatuses }
        });
        const completedProjectsCount = await Job.countDocuments({
            user_id: contractorId,
            status: 'completed'
        });

        // 2. today's Workers Count (Assigned to tasks today)
        const today = new Date();
        const sStart = new Date(today.setHours(0,0,0,0));
        const sEnd = new Date(today.setHours(23,59,59,999));

        const todayTasks = await Job.aggregate([
            { $match: { user_id: contractorId } },
            { $unwind: "$tasks" },
            { 
                $match: { 
                    "tasks.start_date": { $lte: sEnd },
                    "tasks.end_date": { $gte: sStart }
                } 
            },
            { $group: { _id: "$tasks.assigned_worker_id" } }
        ]);
        const todayWorkersCount = todayTasks.length;

        // 3. Operational Alerts
        const alerts = [];
        
        // Alert: Pending Material Requests
        const pendingMaterialsCount = await Job.countDocuments({
            user_id: contractorId,
            status: 'material_pending_approval'
        });
        if (pendingMaterialsCount > 0) {
            alerts.push({ type: 'warning', message: `${pendingMaterialsCount} project(s) awaiting material approval.` });
        }

        // Alert: Pending Contracts (Sent but not accepted)
        const Contract = require('../contracts/contract.model');
        const pendingContractsCount = await Contract.countDocuments({
            contractor_id: contractorId,
            status: 'pending'
        });
        if (pendingContractsCount > 0) {
            alerts.push({ type: 'info', message: `${pendingContractsCount} professional contract(s) awaiting worker signature.` });
        }

        // 4. Monthly Spend (Rule 10.3)
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0,0,0,0);
        const Payment = require('../payments/payment.model');
        const monthSpend = await Payment.aggregate([
            { $match: { user: contractorId, type: 'payout', status: 'completed', createdAt: { $gte: monthStart } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        const uniqueWorkers = await Job.distinct('selected_worker_id', {
            user_id: contractorId,
            selected_worker_id: { $ne: null }
        });
        const totalWorkersCount = uniqueWorkers.length;

        // 5. Total Spend (Lifetime)
        const lifetimeSpend = await Payment.aggregate([
            { $match: { user: contractorId, type: { $in: ['escrow', 'payout'] }, status: 'completed' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        // 6. Build final response
        let wallet = await Wallet.findOne({ user: contractorId });
        
        res.status(200).json({
            success: true,
            data: {
                activeProjects: activeProjectsCount || 0,
                completedProjects: completedProjectsCount || 0,
                todayWorkers: todayWorkersCount || 0,
                totalWorkers: totalWorkersCount || 0,
                totalEarnings: lifetimeSpend[0]?.total || 0,
                pendingPayments: wallet ? wallet.escrowBalance : 0,
                monthlySpend: monthSpend[0]?.total || 0,
                alerts: alerts
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
        const { jobId, title, description, assigned_worker_id, assigned_worker_name, due_date, start_date, end_date, priority, is_recurring, is_short_term, gig_rate } = req.body;

        const job = await Job.findOne({ _id: jobId, user_id: contractorId });
        if (!job) return res.status(404).json({ success: false, message: 'Job not found or unauthorized' });

        // Rule 11.2 Bypass: If short-term gig, no contract required
        if (!is_short_term) {
            const Contract = require('../contracts/contract.model');
            const contract = await Contract.findOne({
                contractor_id: contractorId,
                worker_id: assigned_worker_id,
                status: 'active'
            });

            if (!contract) {
                return res.status(403).json({ 
                    success: false, 
                    message: `Scheduling restricted: This professional must have an ACTIVE signed contract for your project before they can be assigned to tasks. Please hire them first and wait for their acceptance.` 
                });
            }
        } else if (!gig_rate || gig_rate <= 0) {
            return res.status(400).json({ success: false, message: 'Gig rate is required for short-term tasks' });
        }

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
            end_date: eDate ? new Date(eDate) : undefined,
            priority: priority || 'medium',
            is_recurring: is_recurring || false,
            is_short_term: is_short_term || false,
            gig_rate: is_short_term ? gig_rate : undefined
        };

        // If short-term gig, lock escrow funds immediately
        if (is_short_term) {
            const WalletService = require('../wallet/wallet.service');
            await WalletService.lockEscrow(
                contractorId, 
                jobId, 
                assigned_worker_id, 
                gig_rate, 
                `Short-term gig escrow: ${title}`
            );
        }

        job.tasks.push(newTask);
        
        // Ensure worker is in project worker list
        if (assigned_worker_id) {
            job.worker_ids.addToSet(assigned_worker_id);
        }

        
        // Phase 12 Enhancement: Auto-sync project status
        await JobService.syncProjectStatus(job);

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

        // Rule 11.2: Contract must exist before scheduling (Check on update if worker changes)
        if (updateData.assigned_worker_id) {
            const Contract = require('../contracts/contract.model');
            const contract = await Contract.findOne({
                contractor_id: contractorId,
                worker_id: updateData.assigned_worker_id,
                status: 'active'
            });

            if (!contract) {
                return res.status(403).json({ 
                    success: false, 
                    message: "Assignment restricted: This professional must have an ACTIVE signed contract for your project before they can be assigned to tasks." 
                });
            }
        }

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
        if (updateData.assigned_worker_id) {
            task.assigned_worker_id = updateData.assigned_worker_id;
            job.worker_ids.addToSet(updateData.assigned_worker_id);
        }

        if (updateData.assigned_worker_name) task.assigned_worker_name = updateData.assigned_worker_name;
        if (updateData.due_date) task.due_date = new Date(updateData.due_date);
        if (updateData.start_date) task.start_date = new Date(updateData.start_date);
        if (updateData.end_date) task.end_date = new Date(updateData.end_date);
        if (updateData.priority) task.priority = updateData.priority;
        if (updateData.is_recurring !== undefined) task.is_recurring = updateData.is_recurring;

        // Phase 4 Constraint: Log schedule updates
        JobService.appendTimeline(
            job, 
            job.status, 
            'user', 
            `Updated task "${oldTitle}": ${updateData.status ? 'Status changed to ' + updateData.status : 'Schedule modified'}`
        );

        // Auto-sync parent job status from aggregate task states
        if (updateData.status) {
            await JobService.syncProjectStatus(job);
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
        
        // Precise shift windows if provided
        const startTimeStr = req.query.startTime; 
        const endTimeStr = req.query.endTime;

        const windowStart = startTimeStr ? new Date(startTimeStr) : new Date(Date.UTC(sDate.getUTCFullYear(), sDate.getUTCMonth(), sDate.getUTCDate(), 0, 0, 0, 0));
        const windowEnd = endTimeStr ? new Date(endTimeStr) : new Date(Date.UTC(eDate.getUTCFullYear(), eDate.getUTCMonth(), eDate.getUTCDate(), 23, 59, 59, 999));

        const existingTasks = await Job.find({
            tasks: {
                $elemMatch: {
                    assigned_worker_id: workerId,
                    $or: [
                        { due_date: { $gte: windowStart, $lte: windowEnd } },
                        { 
                           start_date: { $lte: windowEnd },
                           end_date: { $gte: windowStart }
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

                    // Precision Overlap check: (TaskStart < WindowEnd && TaskEnd > WindowStart)
                    if (tStart && tEnd && tStart < windowEnd && tEnd > windowStart) {
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

        // Auto-sync project status after task removal
        await JobService.syncProjectStatus(job);

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

/**
 * Add Worker to Pool
 * @route   POST /api/v1/contractors/pool/add
 * @access  Private (Contractor)
 */
exports.addToPool = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { workerId, notes, tags } = req.body;

        if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required' });

        // Find worker profile
        const Worker = require('../workers/worker.model');
        const workerProfile = await Worker.findOne({ user: workerId });
        if (!workerProfile) return res.status(404).json({ success: false, message: 'Worker profile not found' });

        // Create or update pool entry
        const poolEntry = await WorkforcePool.findOneAndUpdate(
            { contractor: contractorId, worker: workerId },
            { 
                contractor: contractorId, 
                worker: workerId, 
                workerProfile: workerProfile._id,
                notes, 
                tags,
                addedAt: new Date() 
            },
            { upsert: true, new: true }
        );

        res.status(200).json({
            success: true,
            message: 'Worker added to your workforce pool',
            data: poolEntry
        });
    } catch (error) {
        logger.error('Add To Pool Error:', error);
        res.status(500).json({ success: false, message: 'Failed to add worker to pool' });
    }
};

/**
 * Remove Worker from Pool
 * @route   DELETE /api/v1/contractors/pool/:workerId
 * @access  Private (Contractor)
 */
exports.removeFromPool = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { workerId } = req.params;

        await WorkforcePool.findOneAndDelete({ contractor: contractorId, worker: workerId });

        res.status(200).json({
            success: true,
            message: 'Worker removed from your workforce pool'
        });
    } catch (error) {
        logger.error('Remove From Pool Error:', error);
        res.status(500).json({ success: false, message: 'Failed to remove worker from pool' });
    }
};

/**
 * Get My Workforce Pool
 * @route   GET /api/v1/contractors/pool
 * @access  Private (Contractor)
 */
exports.getPool = async (req, res) => {
    try {
        const contractorId = req.user._id;
        
        const pool = await WorkforcePool.find({ contractor: contractorId })
            .populate('worker', 'name email phone profileImage isOnline location')
            .populate({
                path: 'workerProfile',
                select: 'skills experience rating totalJobsCompleted verificationStatus'
            })
            .sort({ addedAt: -1 });

        res.status(200).json({
            success: true,
            count: pool.length,
            data: pool
        });
    } catch (error) {
        logger.error('Get Pool Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch workforce pool' });
    }
};

/**
 * Generate Contractor Report (Preview/JSON)
 * @route   GET /api/v1/contractors/reports/generate
 */
exports.generateContractorReport = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { type, startDate, endDate } = req.query;

        if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'Date range (startDate, endDate) is required.' });
        if (new Date(startDate) > new Date(endDate)) return res.status(400).json({ success: false, message: 'Start date cannot be after end date.' });

        const sDate = new Date(startDate);
        const eDate = new Date(endDate);
        const mongoose = require('mongoose');
        const Job = require('../jobs/job.model');
        const Contract = require('../contracts/contract.model');
        const Payment = require('../payments/payment.model');

        let reportData = [];

        if (type === 'project') {
            reportData = await Job.find({
                user_id: contractorId,
                status: 'completed', // Finalized data only
                createdAt: { $gte: sDate, $lte: eDate }
            }).lean();
        } else if (type === 'workforce') {
            reportData = await Contract.find({
                contractor_id: contractorId,
                status: { $in: ['active', 'completed'] },
                createdAt: { $gte: sDate, $lte: eDate }
            }).populate('worker_id', 'name email').lean();
        } else if (type === 'financial') {
            reportData = await Payment.find({
                user: contractorId,
                status: 'completed',
                createdAt: { $gte: sDate, $lte: eDate }
            }).lean();
        } else {
            return res.status(400).json({ success: false, message: 'Invalid report type. Use project, workforce, or financial.' });
        }

        res.status(200).json({
            success: true,
            message: `${type} report generated successfully`,
            metadata: { count: reportData.length, range: { startDate, endDate } },
            data: reportData
        });
    } catch (error) {
        logger.error('Generate Report Error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate report' });
    }
};

/**
 * Download Contractor Report (Placeholder for PDF/CSV)
 * @route   GET /api/v1/contractors/reports/download
 */
exports.downloadContractorReport = async (req, res) => {
    try {
        res.status(200).json({ 
            success: true, 
            message: 'Report is being prepared for download. This endpoint will stream a PDF/CSV file in production.' 
        });
    } catch (error) {
        logger.error('Download Report Error:', error);
        res.status(500).json({ success: false, message: 'Failed to prepare download' });
    }
};

/**
 * Get Project Financial Analysis (Rule 10.3)
 * Formula: Profit = Budget - (Sum of Contracts + Approved Materials)
 * @route   GET /api/v1/contractors/projects/:id/financials
 */
exports.getProjectFinancials = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const jobId = req.params.id;

        const Job = require('../jobs/job.model');
        const Contract = require('../contracts/contract.model');

        const job = await Job.findOne({ _id: jobId, user_id: contractorId }).lean();
        if (!job) return res.status(404).json({ success: false, message: 'Project not found' });

        // 1. Calculate Workforce Cost (Sum of all active/completed/accepted contracts for workers in this project's tasks)
        const workerIds = [...new Set(job.tasks.map(t => t.assigned_worker_id).filter(id => id))];
        
        const contracts = await Contract.find({
            contractor_id: contractorId,
            worker_id: { $in: workerIds },
            status: { $in: ['active', 'completed', 'accepted'] }
        }).lean();

        const totalWorkforceCost = contracts.reduce((sum, c) => {
            const cost = c.agreement_type === 'fixed' ? (c.total_value || 0) : (c.monthly_rate || 0);
            return sum + cost;
        }, 0);

        // 2. Calculate Approved Material Cost
        const approvedMaterials = (job.material_requests || []).filter(m => m.status === 'approved');
        const totalMaterialCost = approvedMaterials.reduce((sum, m) => sum + (m.cost || 0), 0);

        const totalExpenses = totalWorkforceCost + totalMaterialCost;
        const projectRevenue = job.budget || 0;
        const netProfit = projectRevenue - totalExpenses;

        res.status(200).json({
            success: true,
            data: {
                projectTitle: job.job_title,
                revenue: projectRevenue,
                workforceCost: totalWorkforceCost,
                materialCost: totalMaterialCost,
                totalExpenses: totalExpenses,
                netProfit: netProfit,
                profitMargin: projectRevenue > 0 ? ((netProfit / projectRevenue) * 100).toFixed(2) + '%' : '0%',
                contractsUsed: contracts.length
            }
        });
    } catch (error) {
        logger.error('Project Financials Error:', error);
        res.status(500).json({ success: false, message: 'Failed to calculate financials' });
    }
};

