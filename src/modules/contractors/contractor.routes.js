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

// Phase 4: Workforce Scheduling
router.get('/schedule', contractorController.getWorkforceSchedule);
router.get('/schedule/availability/:workerId/:date', contractorController.checkAvailability);
router.post('/schedule/task', contractorController.addTaskToJob);
router.put('/schedule/task/:jobId/:taskId', contractorController.updateTask);

module.exports = router;
