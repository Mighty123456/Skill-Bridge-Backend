const Chat = require('./chat.model');
const Message = require('./message.model');
const { successResponse, errorResponse } = require('../../common/utils/response');

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

        // Ensure user is involved in the job (Owner or Selected Worker or Applicant - simplified check for now)
        // Ideally should check if sender is owner or applicant. For now, assuming UI handles correct ID.

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
        const chats = await Chat.find({ participants: userId })
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
        const { chatId, text } = req.body;
        const senderId = req.user.id;

        if (!chatId || !text) {
            return errorResponse(res, 'Chat ID and text are required', 400);
        }

        const chat = await Chat.findById(chatId).populate('job');
        if (!chat) {
            return errorResponse(res, 'Chat not found', 404);
        }

        if (chat.status === 'blocked' || chat.status === 'archived') {
            return errorResponse(res, 'This chat is archived or blocked.', 403);
        }

        if (chat.job && (chat.job.status === 'completed' || chat.job.status === 'cancelled')) {
            return errorResponse(res, 'Job is completed. Chat is closed.', 403);
        }

        const User = require('../users/user.model');
        const recipientId = chat.participants.find(p => p.toString() !== senderId);
        let deliveredTo = [];

        if (recipientId) {
            const recipient = await User.findById(recipientId);
            // If user is "Online" (toggle on) or we can assume they are connected if we had socket info.
            // Using isOnline field as proxy for "App Open/Available"
            if (recipient && recipient.isOnline) {
                deliveredTo.push(recipientId);
            }
        }

        const message = await Message.create({
            chatId,
            senderId,
            text,
            readBy: [senderId],
            deliveredTo: deliveredTo
        });

        // Update Chat
        chat.lastMessage = text;
        chat.lastMessageTime = Date.now();

        chat.participants.forEach(pId => {
            if (pId.toString() !== senderId) {
                const currentCount = chat.unreadCounts.get(pId.toString()) || 0;
                chat.unreadCounts.set(pId.toString(), currentCount + 1);
            }
        });

        await chat.save();

        try {
            const { getIo } = require('../../socket/socket');
            const io = getIo();
            io.to(chatId).emit('receive_message', message);
        } catch (err) {
            console.error('Socket emit error:', err);
        }

        return successResponse(res, 'Message sent', message, 201);
    } catch (error) {
        console.error('Error sending message:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Get Messages
exports.getMessages = async (req, res) => {
    try {
        const { chatId } = req.params;
        const userId = req.user.id;

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
        const chat = await Chat.findById(chatId);
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
