const express = require('express');
const router = express.Router();
const chatController = require('./chat.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');

// Routes
router.post('/initiate', protect, chatController.initiateChat);
router.get('/', protect, chatController.getUserChats);
router.post('/message', protect, chatController.sendMessage);
router.get('/:chatId/messages', protect, chatController.getMessages);
router.delete('/:chatId', protect, chatController.deleteChat);

module.exports = router;
