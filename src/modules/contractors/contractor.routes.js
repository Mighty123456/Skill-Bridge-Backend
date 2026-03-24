const express = require('express');
const router = express.Router();
const contractorController = require('./contractor.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');

// All contractor routes are protected and require 'contractor' role
router.use(protect);
router.use(authorize('contractor'));

router.get('/dashboard/stats', contractorController.getDashboardStats);
router.get('/reports/analytics', contractorController.getDetailedReports);
router.get('/workers', contractorController.getContractorWorkers);

// Phase 3: Contractor Projects (own jobs with is_contractor_project = true)
router.get('/projects', contractorController.getContractorProjects);
router.patch('/projects/:id/status', contractorController.updateProjectStatus);

// Phase 4: Workforce Scheduling
router.get('/schedule', contractorController.getWorkforceSchedule);
router.get('/schedule/availability/:workerId/:date', contractorController.checkAvailability);
router.post('/schedule/task', contractorController.addTaskToJob);
router.put('/schedule/task/:jobId/:taskId', contractorController.updateTask);
router.delete('/schedule/task/:jobId/:taskId', contractorController.deleteTask);

module.exports = router;

