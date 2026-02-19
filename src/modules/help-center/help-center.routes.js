const express = require('express');
const router = express.Router();
const helpCenterController = require('./help-center.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const { authorize } = require('../../common/middleware/role.middleware');
const { uploadMultiple, catchUploadErrors } = require('../../common/middleware/upload.middleware');

// ============ PUBLIC ROUTES ============

// Knowledge Base (Public - no auth required)
router.get('/knowledge-base', helpCenterController.getArticles);
router.get('/knowledge-base/:articleId', helpCenterController.getArticle);
router.get('/categories', helpCenterController.getCategories);

// ============ PROTECTED ROUTES ============

// Support Tickets (User)
router.get('/tickets', protect, helpCenterController.getTickets);
router.post('/tickets', protect, catchUploadErrors(uploadMultiple('attachments', 5)), helpCenterController.createTicket);
router.get('/tickets/:ticketId', protect, helpCenterController.getTicket);
router.put('/tickets/:ticketId', protect, helpCenterController.updateTicket);
router.post('/tickets/:ticketId/updates', protect, catchUploadErrors(uploadMultiple('attachments', 5)), helpCenterController.addTicketUpdate);
router.post('/tickets/:ticketId/feedback', protect, helpCenterController.submitFeedback);

// Contextual Help (Protected)
router.get('/contextual-help', protect, helpCenterController.getContextualHelp);

// Emergency Support (Protected)
router.post('/emergency', protect, helpCenterController.triggerEmergency);

// ============ ADMIN ROUTES ============

// Admin: Ticket Management
router.get('/admin/tickets', protect, authorize('admin'), helpCenterController.getAllTickets);
router.post('/admin/tickets/:ticketId/reply', protect, authorize('admin'), helpCenterController.adminReplyToTicket);
router.put('/admin/tickets/:ticketId/status', protect, authorize('admin'), helpCenterController.updateTicketStatus);

// Admin: Knowledge Base Management
router.post('/admin/articles', protect, authorize('admin'), catchUploadErrors(uploadMultiple('images', 10)), helpCenterController.createArticle);
router.put('/admin/articles/:articleId', protect, authorize('admin'), catchUploadErrors(uploadMultiple('images', 10)), helpCenterController.updateArticle);
router.delete('/admin/articles/:articleId', protect, authorize('admin'), helpCenterController.deleteArticle);

module.exports = router;
