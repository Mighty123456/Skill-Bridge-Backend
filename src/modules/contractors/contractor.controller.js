const Job = require('../jobs/job.model');
const Wallet = require('../wallet/wallet.model');
const User = require('../users/user.model');
const Contractor = require('./contractor.model');
const logger = require('../../config/logger');

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
        const workers = workerProfiles.map(profile => {
            const user = profile.user || {};
            return {
                id: profile._id,
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
        const { jobId, title, description, assigned_worker_id, assigned_worker_name, due_date } = req.body;

        const job = await Job.findOne({ _id: jobId, user_id: contractorId });
        if (!job) return res.status(404).json({ success: false, message: 'Job not found or unauthorized' });

        const newTask = {
            title,
            description,
            status: 'pending',
            assigned_worker_id,
            assigned_worker_name,
            due_date: new Date(due_date)
        };

        job.tasks.push(newTask);
        await job.save();

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

        if (updateData.title) task.title = updateData.title;
        if (updateData.description) task.description = updateData.description;
        if (updateData.status) task.status = updateData.status;
        if (updateData.assigned_worker_id) task.assigned_worker_id = updateData.assigned_worker_id;
        if (updateData.assigned_worker_name) task.assigned_worker_name = updateData.assigned_worker_name;
        if (updateData.due_date) task.due_date = new Date(updateData.due_date);

        await job.save();

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
        const queryDate = new Date(date);
        
        const startOfDay = new Date(queryDate.setHours(0,0,0,0));
        const endOfDay = new Date(queryDate.setHours(23,59,59,999));

        const existingTasks = await Job.find({
            "tasks.assigned_worker_id": workerId,
            "tasks.due_date": { $gte: startOfDay, $lte: endOfDay }
        });

        // Filter the specific task(s) for that day (since multiple might exist across jobs)
        const dayTasks = [];
        existingTasks.forEach(job => {
            job.tasks.forEach(task => {
                if (task.assigned_worker_id?.toString() === workerId && 
                    task.due_date >= startOfDay && 
                    task.due_date <= endOfDay) {
                    dayTasks.push({
                        jobId: job._id,
                        jobTitle: job.job_title,
                        taskTitle: task.title
                    });
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
