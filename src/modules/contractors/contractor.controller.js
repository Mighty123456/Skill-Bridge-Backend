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

        // Get all unique workers that have worked for this contractor
        const uniqueWorkerIds = await Job.distinct('selected_worker_id', {
            user_id: contractorId,
            selected_worker_id: { $ne: null }
        });

        // Fetch the detailed worker profiles
        const workers = await User.find({
            _id: { $in: uniqueWorkerIds }
        }).select('name email phone profileImage skills experience isVerified isOnline location');

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
