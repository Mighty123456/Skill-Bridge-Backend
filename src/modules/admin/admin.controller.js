const mongoose = require('mongoose');
const Worker = require('../workers/worker.model');
const User = require('../users/user.model');
const Admin = require('./admin.model');
const Badge = require('../workers/badge.model');
const Contractor = require('../contractors/contractor.model');
const Job = require('../jobs/job.model');
const Quotation = require('../quotations/quotation.model');
const Payment = require('../payments/payment.model'); // Added
const Wallet = require('../wallet/wallet.model'); // Added
const Notification = require('../notifications/notification.model');
const Chat = require('../chat/chat.model');
const Message = require('../chat/message.model');
const { decryptChatMessage } = require('../../common/utils/chat-decrypt');
const { ROLES } = require('../../common/constants/roles');
const { successResponse, errorResponse } = require('../../common/utils/response');
const authService = require('../auth/auth.service');
const emailService = require('../../common/services/email.service');
const paymentService = require('../payments/payment.service');
const notifyHelper = require('../../common/notification.helper');
const logger = require('../../config/logger');


/**
 * List professionals for admin, with optional verificationStatus filter.
 * GET /api/admin/professionals?status=pending|verified|rejected
 */
const listProfessionals = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) {
      filter.verificationStatus = status;
    }

    const [workers, contractors] = await Promise.all([
      Worker.find(filter)
        .populate({
          path: 'user',
          select: 'name email phone role address profileImage',
        })
        .populate('badges')
        .sort({ createdAt: -1 }),
      Contractor.find(filter)
        .populate({
          path: 'user',
          select: 'name email phone role address profileImage',
        })
        .sort({ createdAt: -1 }),
    ]);

    const workerSummaries = workers
      .filter((w) => w.user)
      .map((w) => {
        const u = w.user;
        return {
          id: w._id.toString(),
          userId: u._id.toString(),
          name: u.name,
          email: u.email,
          phone: u.phone,
          profileImage: u.profileImage,
          type: 'worker',
          primarySkill: w.skills?.[0] || 'Worker',
          experience: w.experience,
          city: w.city || u.address?.city || null,
          state: u.address?.state || null,
          governmentId: w.governmentId,
          selfie: w.selfie,
          badges: w.badges,
          status: w.verificationStatus,
          reliabilityScore: w.reliabilityScore,
          createdAt: w.createdAt,
        };
      });

    const contractorSummaries = contractors
      .filter((c) => c.user)
      .map((c) => {
        const u = c.user;
        return {
          id: c._id.toString(),
          userId: u._id.toString(),
          name: u.name,
          email: u.email,
          phone: u.phone,
          profileImage: u.profileImage,
          type: 'contractor',
          companyName: c.companyName,
          primarySkill: 'Contractor',
          experience: c.experience,
          city: c.city || u.address?.city || null,
          state: u.address?.state || null,
          governmentId: c.governmentId,
          selfie: c.selfie,
          status: c.verificationStatus,
          reliabilityScore: c.reliabilityScore,
          createdAt: c.createdAt,
        };
      });

    const allProfessionals = [...workerSummaries, ...contractorSummaries].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );

    return successResponse(res, 'Professionals fetched successfully', {
      professionals: allProfessionals,
    });
  } catch (error) {
    logger.error(`Admin listProfessionals error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch professionals', 500);
  }
};

/**
 * Update professional verification status (Worker or Contractor).
 * PATCH /api/admin/professionals/:id/status
 */
const updateProfessionalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const allowedStatuses = ['pending', 'verified', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      return errorResponse(res, 'Invalid status value', 400);
    }

    // Attempt to find in Worker first, then Contractor
    let professional = await Worker.findById(id).populate({
      path: 'user',
      select: 'name email phone role',
    });

    if (!professional) {
      professional = await Contractor.findById(id).populate({
        path: 'user',
        select: 'name email phone role',
      });
    }

    if (!professional || !professional.user) {
      return errorResponse(res, 'Professional not found', 404);
    }

    // Update document
    professional.verificationStatus = status;
    professional.statusHistory.push({
      status,
      reason,
      changedBy: req.userId,
      changedAt: new Date(),
    });
    await professional.save();

    // Mirror on User model
    const user = await User.findById(professional.user._id);
    if (user) {
      user.isVerified = status === 'verified';
      await user.save({ validateBeforeSave: false });
    }

    logger.info(
      `Admin ${req.userId} updated professional ${id} status to ${status}${reason ? ` (reason: ${reason})` : ''
      }`,
    );

    // Send Multi-Channel Notification (Push, In-App, Email)
    if (status === 'verified' || status === 'rejected') {
      await notifyHelper.onVerificationUpdate(professional.user, status, reason);
    }

    return successResponse(res, 'Status updated successfully', { status });
  } catch (error) {
    logger.error(`Admin updateProfessionalStatus error: ${error.message}`);
    return errorResponse(res, 'Failed to update status', 500);
  }
};

/**
 * Admin login (email/password) - only allows role: admin
 * POST /api/admin/login
 */
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);

    if (!result?.user || result.user.role !== ROLES.ADMIN) {
      return errorResponse(res, 'Access denied. Admins only.', 403);
    }

    // Update admin last login using the Admin ID directly
    await Admin.findByIdAndUpdate(
      result.user._id,
      { lastLogin: new Date() }, // Updated field name to match model
      { new: true }
    );

    return successResponse(res, 'Admin login successful', result);
  } catch (error) {
    logger.error(`Admin login error: ${error.message}`);
    return errorResponse(res, error.message || 'Admin login failed', 401);
  }
};

/**
 * List all users with optional role filter
 * GET /api/admin/users?role=worker|user|contractor
 */
const listUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = {};

    if (role) {
      // Validate role
      if (!Object.values(ROLES).includes(role)) {
        return errorResponse(res, 'Invalid role filter', 400);
      }
      filter.role = role;
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    // Enrich users with role-specific details
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const userData = user.toObject();

        if (user.role === ROLES.WORKER) {
          const worker = await Worker.findOne({ user: user._id });
          if (worker) {
            userData.details = {
              services: worker.services,
              skills: worker.skills,
              experience: worker.experience,
              governmentId: worker.governmentId,
              selfie: worker.selfie,
              verificationStatus: worker.verificationStatus,
              city: worker.city || user.address?.city,
              state: user.address?.state
            };
          }
        } else if (user.role === ROLES.CONTRACTOR) {
          const contractor = await Contractor.findOne({ user: user._id });
          if (contractor) {
            userData.details = {
              companyName: contractor.companyName,
              services: contractor.services,
              experience: contractor.experience,
              governmentId: contractor.governmentId,
              selfie: contractor.selfie,
              verificationStatus: contractor.verificationStatus,
              city: user.address?.city,
              state: user.address?.state
            };
          }
        }

        return userData;
      })
    );

    return successResponse(res, 'Users fetched successfully', { users: enrichedUsers });
  } catch (error) {
    logger.error(`Admin listUsers error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch users', 500);
  }
};

/**
 * Update user status (active, suspended, under_review, deactivated)
 * PATCH /api/admin/users/:userId/status
 */
const updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    const allowedStatuses = ['active', 'suspended', 'under_review', 'deactivated'];
    if (!allowedStatuses.includes(status)) {
      return errorResponse(res, 'Invalid status value', 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    user.status = status;
    // Pre-save hook will update isActive automatically
    await user.save();

    logger.info(`Admin ${req.userId} updated user ${userId} status to ${status}`);

    return successResponse(res, 'User status updated successfully', { user });
  } catch (error) {
    logger.error(`Admin updateUserStatus error: ${error.message}`);
    return errorResponse(res, 'Failed to update user status', 500);
  }
};

/**
 * Get dashboard statistics
 * GET /api/admin/stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const [
      pendingWorkers,
      verifiedWorkers,
      totalWorkers,
      pendingContractors,
      verifiedContractors,
      totalContractors,
      totalUsers,
      activeJobs,
      completedJobs,
      emergencyJobs,
      revenueData,
      escrowData
    ] = await Promise.all([
      Worker.countDocuments({ verificationStatus: 'pending' }),
      Worker.countDocuments({ verificationStatus: 'verified' }),
      User.countDocuments({ role: ROLES.WORKER }),
      Contractor.countDocuments({ verificationStatus: 'pending' }),
      Contractor.countDocuments({ verificationStatus: 'verified' }),
      User.countDocuments({ role: ROLES.CONTRACTOR }),
      User.countDocuments({ role: ROLES.USER }),
      Job.countDocuments({ status: { $in: ['assigned', 'eta_confirmed', 'diagnosis_mode', 'material_pending_approval', 'in_progress', 'reviewing', 'cooling_window', 'disputed'] } }),
      Job.countDocuments({ status: 'completed' }),
      Job.countDocuments({ urgency_level: 'emergency', status: { $ne: 'completed' } }), // Active emergency jobs
      Payment.aggregate([
        { $match: { type: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      Payment.aggregate([
        { $match: { type: 'escrow', status: { $in: ['pending', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const totalRevenue = revenueData[0]?.total || 0;
    const escrowBalance = escrowData[0]?.total || 0;

    // New: Platform Financial Stats
    const platformStats = await paymentService.getPlatformStats();

    return successResponse(res, 'Stats fetched successfully', {
      pendingVerifications: pendingWorkers + pendingContractors,
      verifiedWorkers,
      totalWorkers,
      verifiedContractors,
      totalContractors,
      totalVerifiedProfessionals: verifiedWorkers + verifiedContractors,
      totalUsers,
      activeJobs,
      completedJobs,
      emergencyJobs,
      totalRevenue: platformStats.totalRevenue || totalRevenue,
      escrowBalance,
      transactionCount: platformStats.transactionCount || 0
    });
  } catch (error) {
    logger.error(`Admin getDashboardStats error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch dashboard stats', 500);
  }
};

/**
 * Create a new badge
 * POST /api/admin/badges
 */
const createBadge = async (req, res) => {
  try {
    const { name, slug, description, color, icon } = req.body;

    const existingBadge = await Badge.findOne({ slug });
    if (existingBadge) {
      return errorResponse(res, 'Badge with this slug already exists', 400);
    }

    const badge = await Badge.create({
      name,
      slug,
      description,
      color,
      icon,
    });

    return successResponse(res, 'Badge created successfully', { badge }, 201);
  } catch (error) {
    logger.error(`Admin createBadge error: ${error.message}`);
    return errorResponse(res, 'Failed to create badge', 500);
  }
};

/**
 * List all badges
 * GET /api/admin/badges
 */
const listBadges = async (req, res) => {
  try {
    const badges = await Badge.find({ isActive: true }).sort('name');
    return successResponse(res, 'Badges fetched successfully', { badges });
  } catch (error) {
    logger.error(`Admin listBadges error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch badges', 500);
  }
};

/**
 * Assign badge to worker
 * POST /api/admin/workers/:workerId/badges
 */
const assignBadge = async (req, res) => {
  try {
    const { workerId } = req.params;
    const { badgeId } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return errorResponse(res, 'Worker not found', 404);
    }

    const badge = await Badge.findById(badgeId);
    if (!badge) {
      return errorResponse(res, 'Badge not found', 404);
    }

    // Check if already assigned
    if (worker.badges.includes(badgeId)) {
      return errorResponse(res, 'Badge already assigned to this worker', 400);
    }

    worker.badges.push(badgeId);
    await worker.save();

    return successResponse(res, 'Badge assigned successfully');
  } catch (error) {
    logger.error(`Admin assignBadge error: ${error.message}`);
    return errorResponse(res, 'Failed to assign badge', 500);
  }
};

/**
 * Remove badge from worker
 * DELETE /api/admin/workers/:workerId/badges/:badgeId
 */
const removeBadge = async (req, res) => {
  try {
    const { workerId, badgeId } = req.params;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return errorResponse(res, 'Worker not found', 404);
    }

    worker.badges = worker.badges.filter((id) => id.toString() !== badgeId);
    await worker.save();

    return successResponse(res, 'Badge removed successfully');
  } catch (error) {
    logger.error(`Admin removeBadge error: ${error.message}`);
    return errorResponse(res, 'Failed to remove badge', 500);
  }
};

/**
 * Delete user and associated profile
 * DELETE /api/admin/users/:userId
 */
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Role-based cleanup
    if (user.role === ROLES.WORKER) {
      await Worker.findOneAndDelete({ user: userId });
      logger.info(`Deleted associated worker profile for user ${userId}`);
    } else if (user.role === ROLES.CONTRACTOR) {
      await Contractor.findOneAndDelete({ user: userId });
      logger.info(`Deleted associated contractor profile for user ${userId}`);
    }

    // Delete the user itself
    await User.findByIdAndDelete(userId);

    logger.warn(`Admin ${req.userId} deleted user account: ${user.email} (Role: ${user.role})`);

    return successResponse(res, 'User deleted successfully');

  } catch (error) {
    logger.error(`Admin deleteUser error: ${error.message}`);
    return errorResponse(res, 'Failed to delete user', 500);
  }
};

/**
 * List all jobs for admin (with map data)
 * GET /api/admin/jobs
 */
const listJobs = async (req, res) => {
  try {
    const { status } = req.query; // optional filter e.g. ?status=in_progress
    const filter = {};
    if (status) filter.status = status;

    const jobs = await Job.find(filter)
      .populate('user_id', 'name email phone')
      .populate('selected_worker_id', 'name email phone')
      .sort({ created_at: -1 });

    const formattedJobs = jobs.map(job => ({
      id: job._id,
      jobTitle: job.job_title,
      skill: job.skill_required,
      userName: job.user_id?.name || 'Unknown',
      userEmail: job.user_id?.email || '',
      location: job.location?.address_text || 'Unknown',
      coordinates: job.location?.coordinates || [0, 0], // [lng, lat]
      urgency: job.urgency_level,
      isEmergency: job.is_emergency,
      status: job.status,
      selectedWorker: job.selected_worker_id?.name || null,
      selectedWorkerEmail: job.selected_worker_id?.email || null,
      workerLocation: job.journey?.worker_location || null,
      startedAt: job.started_at || job.journey?.started_at || null,
      completedAt: job.completed_at || null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      // Enhanced details
      description: job.job_description || 'No description provided',
      issuePhotos: job.issue_photos || [],
      diagnosisReport: job.diagnosis_report || null,
      materialRequests: job.material_requests || [],
      completionPhotos: job.completion_photos || [],
      workSummary: job.work_summary || '',
      signature: job.digital_signature || null,
      timeline: job.timeline || []
    }));

    return successResponse(res, 'Jobs fetched successfully', { jobs: formattedJobs });
  } catch (error) {
    logger.error(`Admin listJobs error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch jobs', 500);
  }
};

/**
 * List all quotations for admin
 * GET /api/admin/quotations
 */
const listQuotations = async (req, res) => {
  try {
    const quotations = await Quotation.find()
      .populate('job_id', 'job_title skill_required')
      .populate('worker_id', 'name email')
      .sort({ created_at: -1 });

    const formattedQuotations = quotations.map(q => ({
      id: q._id,
      jobId: q.job_id?._id,
      jobTitle: q.job_id?.job_title,
      workerName: q.worker_id?.name || 'Unknown',
      laborCost: q.labor_cost,
      materialCost: q.material_cost,
      totalCost: q.total_cost,
      status: q.status,
      createdAt: q.created_at,
      rankingScore: q.rankingScore,
      tier: q.tier,
    }));

    return successResponse(res, 'Quotations fetched successfully', { quotations: formattedQuotations });
  } catch (error) {
    logger.error(`Admin listQuotations error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch quotations', 500);
  }
};

/**
 * Verify Ledger Integrity
 * GET /api/admin/ledger/verify
 */
const verifyLedger = async (req, res) => {
  try {
    const report = await paymentService.verifyLedger();
    return successResponse(res, 'Ledger verification completed', report);
  } catch (error) {
    logger.error(`Admin verifyLedger error: ${error.message}`);
    return errorResponse(res, 'Failed to verify ledger', 500);
  }
};

/**
 * Get Tenant Financial Profile (Spending, Escrow, Wallet)
 * GET /api/admin/tenants/:tenantId/financials
 */
const getTenantFinancials = async (req, res) => {
  try {
    const { tenantId } = req.params;

    const user = await User.findById(tenantId).select('name email role');
    if (!user) return errorResponse(res, 'Tenant not found', 404);

    const [wallet, spendingData, transactionHistory] = await Promise.all([
      Wallet.findOne({ user: tenantId }),
      Payment.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(tenantId) } },
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]),
      Payment.find({ user: tenantId })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('job', 'job_title status')
    ]);

    // Format spending stats
    const stats = {
      totalTopups: 0,
      totalSpent: 0, // Sum of completed escrows/payments
      activeEscrow: 0,
      totalRefunds: 0
    };

    spendingData.forEach(item => {
      if (item._id === 'topup') stats.totalTopups = item.total;
      if (item._id === 'escrow') stats.totalSpent = item.total; // Total ever committed to jobs
      if (item._id === 'refund') stats.totalRefunds = item.total;
    });

    return successResponse(res, 'Tenant financials fetched', {
      tenant: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      wallet: {
        balance: wallet?.balance || 0,
        escrowBalance: wallet?.escrowBalance || 0,
        currency: wallet?.currency || 'INR'
      },
      stats,
      history: transactionHistory.map(p => ({
        id: p._id,
        type: p.type,
        amount: p.amount,
        status: p.status,
        date: p.createdAt,
        jobTitle: p.job?.job_title || 'N/A',
        transactionId: p.transactionId
      }))
    });
  } catch (error) {
    logger.error(`Admin getTenantFinancials error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch tenant financials', 500);
  }
};

/**
 * Get Worker Financial Profile (Earnings, Wallet, Payouts)
 * GET /api/admin/workers/:workerId/financials
 */
const getWorkerFinancials = async (req, res) => {
  try {
    const { workerId } = req.params;

    // Find the worker profile first
    const worker = await Worker.findById(workerId).populate('user', 'name email');
    if (!worker) return errorResponse(res, 'Worker not found', 404);

    const userId = worker.user._id;

    const [wallet, earningsData, history] = await Promise.all([
      Wallet.findOne({ user: userId }),
      Payment.aggregate([
        { $match: { worker: userId, type: 'payout', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),
      Payment.find({
        $or: [
          { worker: userId },
          { user: userId, type: { $in: ['payout', 'escrow', 'refund'] } }
        ]
      })
        .sort({ createdAt: -1 })
        .limit(20)
    ]);

    return successResponse(res, 'Worker financials fetched', {
      worker: {
        id: worker._id,
        name: worker.user.name,
        email: worker.user.email,
        totalJobsCompleted: worker.totalJobsCompleted || 0
      },
      wallet: {
        balance: wallet?.balance || 0,
        pendingBalance: wallet?.pendingBalance || 0,
        currency: wallet?.currency || 'INR',
        pendingPayouts: wallet?.pendingPayouts || []
      },
      stats: {
        totalEarnings: earningsData[0]?.total || 0,
        payoutCount: earningsData[0]?.count || 0
      },
      history: history.map(p => ({
        id: p._id,
        type: p.type,
        amount: p.amount,
        status: p.status,
        date: p.createdAt,
        jobId: p.job,
        transactionId: p.transactionId
      }))
    });
  } catch (error) {
    logger.error(`Admin getWorkerFinancials error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch worker financials', 500);
  }
};

/**
 * List all active disputes
 * GET /api/admin/disputes
 */
const listDisputes = async (req, res) => {
  try {
    const disputes = await Job.find({ 'dispute.is_disputed': true })
      .populate('user_id', 'name email phone')
      .populate('selected_worker_id', 'name email phone')
      .sort({ 'dispute.opened_at': -1 });

    const formatted = disputes.map(job => ({
      jobId: job._id,
      jobTitle: job.job_title,
      tenant: job.user_id,
      worker: job.selected_worker_id,
      reason: job.dispute.reason,
      openedAt: job.dispute.opened_at,
      status: job.dispute.status,
      totalCost: job.diagnosis_report?.final_total_cost || 0
    }));

    return successResponse(res, 'Disputes fetched successfully', { disputes: formatted });
  } catch (error) {
    logger.error(`Admin listDisputes error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch disputes', 500);
  }
};

/**
 * List all active warranty claims
 * GET /api/admin/warranties
 */
const listWarrantyClaims = async (req, res) => {
  try {
    const claims = await Job.find({ 'warranty_claim.active': true })
      .populate('user_id', 'name email phone')
      .populate('selected_worker_id', 'name email phone')
      .sort({ 'warranty_claim.claimed_at': -1 });

    const formatted = claims.map(job => ({
      jobId: job._id,
      jobTitle: job.job_title,
      tenant: job.user_id,
      worker: job.selected_worker_id,
      reason: job.warranty_claim.reason,
      claimedAt: job.warranty_claim.claimed_at,
      resolved: job.warranty_claim.resolved,
      warrantyDuration: job.diagnosis_report?.warranty_duration_days || 0
    }));

    return successResponse(res, 'Warranty claims fetched successfully', { claims: formatted });
  } catch (error) {
    logger.error(`Admin listWarrantyClaims error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch warranty claims', 500);
  }
};

/**
 * Get System Health
 * GET /api/admin/health
 */
const getSystemHealth = async (req, res) => {
  try {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();

    // Database Health
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    const healthData = {
      status: 'healthy',
      timestamp: new Date(),
      nodeVersion: process.version,
      platform: process.platform,
      uptime: {
        seconds: Math.floor(uptime),
        formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
      },
      memory: {
        rss: `${Math.round(memUsage.rss / 1024 / 1024 * 100) / 100} MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100} MB`,
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100} MB`
      },
      database: {
        status: dbStatus,
        name: mongoose.connection.name
      }
    };

    return successResponse(res, 'System health fetched successfully', healthData);
  } catch (error) {
    logger.error(`Admin getSystemHealth error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch system health', 500);
  }
};

/**
 * Broadcast notification to all or specific roles
 * POST /api/admin/notifications/broadcast
 */
const broadcastNotification = async (req, res) => {
  try {
    const { title, message, targetRole, type = 'system' } = req.body;

    if (!title || !message) {
      return errorResponse(res, 'Title and message are required', 400);
    }

    const filter = {};
    if (targetRole && targetRole !== 'all') {
      filter.role = targetRole;
    }

    const users = await User.find(filter).select('_id name fcmTokens');

    // Send Multi-Channel Broadcast
    await notifyHelper.onBroadcast(users, title, message, type);

    logger.info(`Admin ${req.userId} broadcasted notification to ${users.length} users (Role: ${targetRole || 'all'})`);

    return successResponse(res, `Broadcast successful to ${users.length} users`);
  } catch (error) {
    logger.error(`Admin broadcastNotification error: ${error.message}`);
    return errorResponse(res, 'Failed to broadcast notification', 500);
  }
};

/**
 * Get Performance Analytics (SLAs, Delays, Skill Trends)
 * GET /api/admin/analytics/performance
 */
const getPerformanceAnalytics = async (req, res) => {
  try {
    const stats = await Job.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$skill_required',
          avgCompletionTimeHrs: {
            $avg: { $divide: [{ $subtract: ['$completed_at', '$started_at'] }, 3600000] }
          },
          totalJobs: { $sum: 1 },
          delayCount: {
            $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$journey.delays', []] } }, 0] }, 1, 0] }
          }
        }
      },
      { $sort: { totalJobs: -1 } }
    ]);

    // SLA Breakdown for Emergency Jobs
    const emergencySla = await Job.aggregate([
      { $match: { urgency_level: 'emergency', status: 'completed' } },
      {
        $group: {
          _id: null,
          avgResponseTimeMin: {
            $avg: { $divide: [{ $subtract: ['$journey.arrived_at', '$created_at'] }, 60000] }
          },
          totalEmergencyJobs: { $sum: 1 }
        }
      }
    ]);

    // Job Success vs Failure Rates
    const jobSuccessStats = await Job.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Monthly Revenue Trend (Last 6 Months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const revenueTrend = await Payment.aggregate([
      {
        $match: {
          type: 'commission',
          status: 'completed',
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Geo Distribution of Jobs
    const geoDistribution = await Job.aggregate([
      {
        $match: {
          status: { $in: ['open', 'assigned', 'in_progress', 'completed'] },
          'location.coordinates': { $exists: true }
        }
      },
      {
        $project: {
          lat: { $arrayElemAt: ['$location.coordinates', 1] },
          lng: { $arrayElemAt: ['$location.coordinates', 0] },
          skill: '$skill_required',
          status: '$status'
        }
      }
    ]);

    return successResponse(res, 'Performance analytics fetched', {
      skillTrends: stats,
      emergencySla: emergencySla[0] || { avgResponseTimeMin: 0, totalEmergencyJobs: 0 },
      jobSuccessStats,
      revenueTrend,
      geoDistribution
    });
  } catch (error) {
    logger.error(`Admin getPerformanceAnalytics error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch performance analytics', 500);
  }
};

/**
 * List Legal Audit Logs (Terms/Privacy Acceptance)
 * GET /api/admin/legal/audit
 */
const listLegalAuditLogs = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = { 'legal.termsAccepted': true };
    if (role) filter.role = role;

    const logs = await User.find(filter)
      .select('name email role legal.termsAcceptedAt legal.termsVersion legal.privacyAcceptedAt legal.privacyVersion legal.ipAddress')
      .sort({ 'legal.termsAcceptedAt': -1 })
      .limit(100);

    return successResponse(res, 'Legal audit logs fetched', { logs });
  } catch (error) {
    logger.error(`Admin listLegalAuditLogs error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch legal logs', 500);
  }
};

/**
 * Admin: List all active job chats
 */
const listAllChats = async (req, res) => {
  try {
    const { status, jobId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (jobId) filter.job = jobId;

    const chats = await Chat.find(filter)
      .populate('participants', 'name email role profileImage chatStrikes chatMutedUntil')
      .populate('job', 'job_title status user_id selected_worker_id')
      .sort({ lastMessageTime: -1 })
      .limit(100)
      .lean();

    const chatsDecrypted = chats.map((c) => ({
      ...c,
      lastMessage: c.lastMessage ? decryptChatMessage(c.lastMessage) : c.lastMessage
    }));

    return successResponse(res, 'All chats fetched', { chats: chatsDecrypted });
  } catch (error) {
    logger.error(`Admin listAllChats error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch chats', 500);
  }
};

/**
 * Admin: View messages for any chat
 */
const getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const messages = await Message.find({ chatId }).sort({ createdAt: 1 }).lean();
    const messagesDecrypted = messages.map((m) => ({
      ...m,
      text: m.text ? decryptChatMessage(m.text) : m.text
    }));
    return successResponse(res, 'Messages fetched', { messages: messagesDecrypted });
  } catch (error) {
    logger.error(`Admin getChatMessages error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch messages', 500);
  }
};

module.exports = {
  listProfessionals,
  updateProfessionalStatus,
  adminLogin,
  listUsers,
  getDashboardStats,
  createBadge,
  listBadges,
  assignBadge,
  removeBadge,
  deleteUser,
  updateUserStatus,
  listJobs,
  listQuotations,
  verifyLedger,
  getWorkerFinancials,
  getTenantFinancials,
  listDisputes,
  listWarrantyClaims,
  getSystemHealth,
  broadcastNotification,
  getPerformanceAnalytics,
  listLegalAuditLogs,
  listAllChats,
  getChatMessages,
};


