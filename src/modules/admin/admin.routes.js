const express = require('express');
const { validationResult } = require('express-validator');
const router = express.Router();

const { authenticate } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const { ROLES } = require('../../common/constants/roles');
const adminController = require('./admin.controller');
const authSchema = require('../auth/auth.schema');

// Reusable validate middleware (mirrors auth.routes validate)
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      if (typeof next === 'function') {
        return next();
      }
      return;
    }

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  };
};

// Admin login (role must be admin)
router.post('/login', validate(authSchema.loginSchema), adminController.adminLogin);

// List professionals with optional verification status filter
router.get(
  '/professionals',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listProfessionals,
);

// Update professional verification status
router.patch(
  '/professionals/:id/status',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateProfessionalStatus,
);

// Update professional reliability score
router.patch(
  '/professionals/:id/reliability',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateProfessionalReliabilityScore,
);

// List all users (User, Worker, Contractor)
router.get(
  '/users',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listUsers,
);

// Delete user account
router.delete(
  '/users/:userId',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.deleteUser,
);

// Update user status
router.patch(
  '/users/:userId/status',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateUserStatus,
);

// Get dashboard statistics
router.get(
  '/stats',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getDashboardStats,
);

// Badge Management Routes
router.post(
  '/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.createBadge
);

router.get(
  '/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listBadges
);

router.post(
  '/workers/:workerId/badges',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.assignBadge
);

router.delete(
  '/workers/:workerId/badges/:badgeId',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.removeBadge
);

// Worker Financials
router.get(
  '/workers/:workerId/financials',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getWorkerFinancials
);

// Force-release worker's warranty reserve (admin override)
router.post(
  '/workers/:workerId/force-release-warranty',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.forceReleaseWorkerWarranty
);

// Tenant Financials
router.get(
  '/tenants/:tenantId/financials',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getTenantFinancials
);

// List all jobs
router.get(
  '/jobs',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listJobs
);

// Force Escalation & Escrow Actions
router.post(
  '/jobs/:id/force-release',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.forceReleasePayment
);

router.post(
  '/jobs/:id/cancel-refund',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.cancelAndRefundJob
);

// List all quotations
router.get(
  '/quotations',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listQuotations
);

// Ledger Verification
router.get(
  '/ledger/verify',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.verifyLedger
);

// Dispute Monitoring
router.get(
  '/disputes',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listDisputes
);

// Warranty Monitoring
router.get(
  '/warranties',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listWarrantyClaims
);

// System Health
router.get(
  '/health',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getSystemHealth
);

// Global Broadcast
router.post(
  '/notifications/broadcast',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.broadcastNotification
);

// Performance Analytics
router.get(
  '/analytics/performance',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getPerformanceAnalytics
);

// Legal & Compliance Audit
router.get(
  '/legal/audit',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listLegalAuditLogs
);

// Chat Moderation Terminal
router.get(
  '/chats',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listAllChats
);

router.get(
  '/chats/:chatId/messages',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getChatMessages
);

// --- New Routes ---

// System Config
router.get(
  '/config',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getSystemConfig
);

router.patch(
  '/config',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.updateSystemConfig
);

// Ratings Moderation
router.get(
  '/ratings',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listRatings
);

router.patch(
  '/ratings/:id/flag',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.flagRating
);

router.delete(
  '/ratings/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.deleteRating
);

// Role Stats
router.get(
  '/roles/stats',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getRoleStats
);

// Audit Logs
router.get(
  '/audit-logs',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listAuditLogs
);

// Hiring Requests Monitoring
router.get(
  '/hiring-requests',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listHiringRequests
);

// Agreement Vault (Contracts)
router.get(
  '/contracts',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listAllContracts
);

router.get(
  '/contracts/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getContractById
);

router.post(
  '/contracts/:id/force-terminate',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.forceTerminateContract
);

router.post(
  '/contracts/:id/cycles/:cycleId/resolve',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.resolveCycleDispute
);

// Contract Audits & Monitoring
router.get(
  '/contracts/monitoring/hourly',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getHourlyContractAudits
);

router.get(
  '/contracts/monitoring/short-term',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getShortTermGigAudits
);


// Workforce Pool Monitoring
router.get(
  '/contractors/pools',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.listAllWorkforcePools
);

router.get(
  '/contractors/:id/pool',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getContractorPool
);

// Operations Calendar Oversight
router.get(
  '/calendar/overview',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getCalendarOverview
);

// Escrow & Financial Control Hub
router.get(
  '/escrow/summary',
  authenticate,
  authorize(ROLES.ADMIN),
  adminController.getEscrowSummary
);

module.exports = router;