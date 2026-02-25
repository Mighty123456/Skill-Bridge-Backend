const Chat = require('./chat.model');
const Message = require('./message.model');
const { successResponse, errorResponse } = require('../../common/utils/response');
const User = require('../users/user.model');
const logger = require('../../config/logger');
const chatService = require('./chat.service');

// Initiate (or get existing) chat
exports.initiateChat = async (req, res) => {
    try {
        const { recipientId, jobId } = req.body;
        const senderId = req.user.id;

        if (!recipientId || !jobId) {
            return errorResponse(res, 'Recipient ID and Job ID are required', 400);
        }

        // Check if chat exists for this job and participants
        let chat = await Chat.findOne({
            job: jobId,
            participants: { $all: [senderId, recipientId] }
        });

        if (chat) {
            // Un-delete if the user had previously deleted it
            if (chat.deletedBy && chat.deletedBy.map(id => id.toString()).includes(senderId)) {
                chat.deletedBy = chat.deletedBy.filter(id => id.toString() !== senderId);
                await chat.save();
            }

            chat = await Chat.findById(chat._id)
                .populate('participants', 'name profileImage role')
                .populate('job', 'job_title status');
            return successResponse(res, 'Chat retrieved successfully', chat);
        }

        // Validate Job exists
        const Job = require('../jobs/job.model');
        const job = await Job.findById(jobId);
        if (!job) {
            return errorResponse(res, 'Job not found', 404);
        }

        // Create new chat
        const newChat = await Chat.create({
            participants: [senderId, recipientId],
            job: jobId,
            unreadCounts: {
                [senderId]: 0,
                [recipientId]: 0
            }
        });

        const populatedChat = await Chat.findById(newChat._id)
            .populate('participants', 'name profileImage role')
            .populate('job', 'job_title status');

        return successResponse(res, 'Chat initiated successfully', populatedChat, 201);
    } catch (error) {
        console.error('Error initiating chat:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Get User Chats
exports.getUserChats = async (req, res) => {
    try {
        const userId = req.user.id;
        const chats = await Chat.find({
            participants: userId,
            deletedBy: { $ne: userId }
        })
            .populate('participants', 'name profileImage role')
            .populate('job', 'job_title status')
            .sort({ lastMessageTime: -1 });

        return successResponse(res, 'Chats retrieved successfully', chats);
    } catch (error) {
        console.error('Error fetching chats:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Send Message
exports.sendMessage = async (req, res) => {
    try {
        const { chatId, text, media, encrypted } = req.body;
        const senderId = req.user.id;

        const { message, systemMessage } = await chatService.processAndSendMessage({
            chatId,
            senderId,
            text,
            media,
            isEncrypted: encrypted
        });

        // Socket emit handled by the caller or helper (since we are in REST controller, we use getIo)
        try {
            const { getIo } = require('../../socket/socket');
            const io = getIo();
            const chatIdStr = chatId.toString();

            io.to(chatIdStr).emit('receive_message', message.toObject());
            if (systemMessage) {
                io.to(chatIdStr).emit('receive_message', systemMessage.toObject());
            }
        } catch (socketErr) {
            logger.error(`Socket broadcast failed: ${socketErr.message}`);
        }

        return successResponse(res, 'Message sent', message, 201);
    } catch (error) {
        if (error.status) {
            return errorResponse(res, error.message, error.status);
        }
        logger.error('Error sending message:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Get Messages
exports.getMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id;

        // --- OWNERSHIP CHECK (Constraint: Participant Verification) ---
        const chat = await Chat.findById(chatId);
        if (!chat) {
            return errorResponse(res, 'Chat not found', 404);
        }
        if (!chat.participants.map(p => p.toString()).includes(userId)) {
            return errorResponse(res, 'Unauthorized: You are not a participant in this chat', 403);
        }

        const messages = await Message.find({ chatId }).sort({ createdAt: 1 });

        // Update read status for these messages
        // Find messages not read by me
        const unreadMessagesStringIds = messages
            .filter(m => !m.readBy.map(id => id.toString()).includes(userId))
            .map(m => m._id);

        if (unreadMessagesStringIds.length > 0) {
            await Message.updateMany(
                { _id: { $in: unreadMessagesStringIds } },
                { $addToSet: { readBy: userId, deliveredTo: userId } } // Reading implies delivery
            );

            // Emit 'messages_read' event to the chat room so sender updates UI
            try {
                const { getIo } = require('../../socket/socket');
                const io = getIo();
                io.to(chatId).emit('messages_read', {
                    messageIds: unreadMessagesStringIds,
                    readBy: userId,
                    chatId
                });
            } catch (e) {
                console.error('Socket emit read error', e);
            }
        }

        // Reset unread count for this user
        if (chat) {
            if (!chat.unreadCounts) { chat.unreadCounts = new Map(); }
            if (chat.unreadCounts.get(userId) > 0) {
                chat.unreadCounts.set(userId, 0);
                await chat.save();
            }
        }

        // Return updated messages (refetched or manually updated in memory? Refetch is safer but slower. 
        // For now, let's just return the original list but we know logic updated DB. 
        // Ideally should assume client treats them as read if it requested them? 
        // Client will see its own ID in readBy if we refetch. Let's refetch if we updated.)

        if (unreadMessagesStringIds.length > 0) {
            const updatedMessages = await Message.find({ chatId }).sort({ createdAt: 1 });
            return successResponse(res, 'Messages retrieved', updatedMessages);
        }

        return successResponse(res, 'Messages retrieved', messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        return errorResponse(res, 'Server error', 500);
    }
}

// Delete Chat (Clear from user's list)
exports.deleteChat = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id;

        const chat = await Chat.findById(chatId);
        if (!chat) return errorResponse(res, 'Chat not found', 404);

        if (!chat.participants.map(p => p.toString()).includes(userId)) {
            return errorResponse(res, 'Unauthorized', 403);
        }

        // To "delete" like WhatsApp, we add the user to a "deletedBy" array
        // We need to add deletedBy to the schema, or we can just clear the messages for them (like clear chat)
        // A common pattern is having a 'clearedAt' timestamp per user, or physically removing them from participants if both delete
        // If they want to just delete the chat entirely from view:
        if (!chat.deletedBy) chat.deletedBy = [];
        if (!chat.deletedBy.map(id => id.toString()).includes(userId)) {
            chat.deletedBy.push(userId);
            await chat.save();
        }

        return successResponse(res, 'Chat deleted successfully');
    } catch (error) {
        logger.error('Error deleting chat:', error);
        return errorResponse(res, 'Server error', 500);
    }
};
