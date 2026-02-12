const express = require('express');
const router = express.Router();
const notificationController = require('./notification.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');

router.get('/', protect, notificationController.getNotifications);
router.patch('/:id/read', protect, notificationController.markAsRead);
router.delete('/:id', protect, notificationController.deleteNotification);

module.exports = router;
