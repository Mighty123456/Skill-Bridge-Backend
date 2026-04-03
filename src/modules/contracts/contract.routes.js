const express = require('express');
const router = express.Router();
const contractController = require('./contract.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// All contract routes require authentication
router.use(protect);

// Create a new contract (Contractor only)
router.post(
  '/', 
  authorize('contractor'), 
  contractController.createContract
);

// Bulk Create Contracts (Contractor only)
router.post(
  '/bulk', 
  authorize('contractor'), 
  contractController.createBulkContracts
);

// List all contracts for the authenticated user
router.get(
  '/', 
  contractController.listContracts
);

// Get a single contract's details
router.get(
  '/:id', 
  contractController.getContractDetails
);

// Download contract as PDF
router.get(
  '/:id/download',
  contractController.downloadContractPDF
);

// Worker responds to a contract proposal
router.patch(
  '/:id/respond', 
  authorize('worker'), 
  contractController.respondToContract
);

// Terminate/cancel an agreement
router.patch(
  '/:id/terminate', 
  contractController.terminateContract
);

// Activate an accepted agreement (Contractor only)
router.patch(
  '/:id/activate',
  authorize('contractor'),
  contractController.activateContract
);

// Extend an agreement (Contractor only)
router.patch(
  '/:id/extend',
  authorize('contractor'),
  contractController.extendContract
);

// Raise a dispute on an agreement
router.post(
  '/:id/dispute',
  contractController.raiseContractDispute
);

// Pause active contract
router.patch(
  '/:id/pause',
  contractController.pauseContract
);

// Resume paused contract
router.patch(
  '/:id/resume',
  contractController.resumeContract
);

// Add work log (Worker only)
router.post(
  '/:id/work-log',
  authorize('worker'),
  contractController.addWorkLog
);

module.exports = router;
