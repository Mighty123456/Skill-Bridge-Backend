const express = require('express');
const router = express.Router();
const contractorController = require('./contractor.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// All contractor routes are protected and require 'contractor' role
router.use(protect);
router.use(authorize('contractor'));

router.get('/dashboard/stats', contractorController.getDashboardStats);
router.get('/workers', contractorController.getContractorWorkers);

module.exports = router;
