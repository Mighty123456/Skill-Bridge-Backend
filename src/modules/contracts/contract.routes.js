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

module.exports = router;
