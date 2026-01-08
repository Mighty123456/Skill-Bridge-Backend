const Worker = require('../workers/worker.model');
const User = require('../users/user.model');
const Admin = require('./admin.model');
const Badge = require('../workers/badge.model');
const Contractor = require('../contractors/contractor.model');
const { ROLES } = require('../../common/constants/roles');
const { successResponse, errorResponse } = require('../../common/utils/response');
const authService = require('../auth/auth.service');
const emailService = require('../../common/services/email.service');
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

    // Send email notification
    if (status === 'verified' || status === 'rejected') {
      emailService.sendVerificationEmail(
        professional.user.email,
        professional.user.name,
        status,
        reason
      ).catch(err => logger.error(`Failed to send verification email: ${err.message}`));
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
      totalUsers
    ] = await Promise.all([
      Worker.countDocuments({ verificationStatus: 'pending' }),
      Worker.countDocuments({ verificationStatus: 'verified' }),
      User.countDocuments({ role: ROLES.WORKER }),
      Contractor.countDocuments({ verificationStatus: 'pending' }),
      Contractor.countDocuments({ verificationStatus: 'verified' }),
      User.countDocuments({ role: ROLES.CONTRACTOR }),
      User.countDocuments({ role: ROLES.USER }),
    ]);

    return successResponse(res, 'Stats fetched successfully', {
      pendingVerifications: pendingWorkers + pendingContractors,
      verifiedWorkers,
      totalWorkers,
      verifiedContractors,
      totalContractors,
      totalVerifiedProfessionals: verifiedWorkers + verifiedContractors,
      totalUsers,
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

    return successResponse(res, 'User and associated profiles deleted successfully');
  } catch (error) {
    logger.error(`Admin deleteUser error: ${error.message}`);
    return errorResponse(res, 'Failed to delete user', 500);
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
};


