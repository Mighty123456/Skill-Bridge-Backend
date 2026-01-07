const Worker = require('../workers/worker.model');
const User = require('../users/user.model');
const Admin = require('./admin.model');
const { ROLES } = require('../../common/constants/roles');
const { successResponse, errorResponse } = require('../../common/utils/response');
const authService = require('../auth/auth.service');
const logger = require('../../config/logger');

/**
 * List workers for admin, with optional verificationStatus filter.
 * GET /api/admin/workers?status=pending|verified|rejected
 */
const listWorkers = async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status) {
      filter.verificationStatus = status;
    }

    // List workers for admin, with optional verificationStatus filter
    const workers = await Worker.find(filter)
      .populate({
        path: 'user',
        select: 'name email phone role address profileImage', // Added profileImage
      })
      .sort({ createdAt: -1 });

    const summaries = workers
      .filter((w) => w.user) // in case of orphaned records
      .map((w) => {
        const u = w.user;
        return {
          id: w._id.toString(),
          userId: u._id.toString(),
          name: u.name,
          email: u.email,
          phone: u.phone,
          profileImage: u.profileImage,

          // Worker specific fields
          services: w.services,
          skills: w.skills,
          experience: w.experience,
          city: w.city || u.address?.city || null,

          // Verification docs
          governmentId: w.governmentId,
          selfie: w.selfie,

          status: w.verificationStatus,
          createdAt: w.createdAt,
        };
      });

    return successResponse(res, 'Workers fetched successfully', { workers: summaries });
  } catch (error) {
    logger.error(`Admin listWorkers error: ${error.message}`);
    return errorResponse(res, 'Failed to fetch workers', 500);
  }
};

/**
 * Update worker verification status.
 * PATCH /api/admin/workers/:workerId/status
 * Body: { status: 'pending' | 'verified' | 'rejected', reason?: string }
 */
const updateWorkerStatus = async (req, res) => {
  try {
    const { workerId } = req.params;
    const { status, reason } = req.body;

    const allowedStatuses = ['pending', 'verified', 'rejected'];
    if (!allowedStatuses.includes(status)) {
      return errorResponse(res, 'Invalid status value', 400);
    }

    const worker = await Worker.findById(workerId).populate({
      path: 'user',
      select: 'name email phone role verificationStatus isVerified',
    });

    if (!worker || !worker.user) {
      return errorResponse(res, 'Worker not found', 404);
    }

    // Update worker document
    worker.verificationStatus = status;
    worker.statusHistory.push({
      status,
      reason,
      changedBy: req.userId, // This ID comes from auth middleware (Admin ID)
      changedAt: new Date(),
    });
    await worker.save();

    // Mirror status on User model for backward compatibility
    // Note: User model might not have verificationStatus field depending on recent refactor 
    // but keeping it safe if field exists.
    const user = await User.findById(worker.user._id);
    if (user) {
      // Only set if fields exist in schema
      if (user.schema && user.schema.path('verificationStatus')) {
        user.verificationStatus = status;
      }
      if (user.schema && user.schema.path('isVerified')) {
        user.isVerified = status === 'verified';
      }
      await user.save({ validateBeforeSave: false });
    }

    logger.info(
      `Admin ${req.userId} updated worker ${workerId} status to ${status}${reason ? ` (reason: ${reason})` : ''
      }`,
    );

    return successResponse(res, 'Worker status updated successfully', { status });
  } catch (error) {
    logger.error(`Admin updateWorkerStatus error: ${error.message}`);
    return errorResponse(res, 'Failed to update worker status', 500);
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

module.exports = {
  listWorkers,
  updateWorkerStatus,
  adminLogin,
};


