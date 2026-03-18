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

        // Check if chat exists for these participants (Reuse existing chat for the same person)
        let chat = await Chat.findOne({
            participants: { $all: [senderId, recipientId] }
        });

        if (chat) {
            // Update to latest job context and reactivate
            chat.job = jobId;
            chat.status = 'active'; 
            chat.lastMessageTime = new Date(); // Move to top of list as it's "re-initiated"

            // Un-delete for the sender
            if (chat.deletedBy && chat.deletedBy.map(id => id.toString()).includes(senderId)) {
                chat.deletedBy = chat.deletedBy.filter(id => id.toString() !== senderId);
            }
            
            await chat.save();

            chat = await Chat.findById(chat._id)
                .populate('participants', 'name profileImage role')
                .populate('job', 'job_title status dispute');
            return successResponse(res, 'Chat retrieved successfully', chat);
        }

        // Validate Job exists and status
        const Job = require('../jobs/job.model');
        const job = await Job.findById(jobId);
        if (!job) {
            return errorResponse(res, 'Job not found', 404);
        }

        // Constraint: Chat only enabled after job assignment
        // Allow if status is assigned, in_progress, completed, reviewing, disputed
        const allowedStatuses = ['assigned', 'in_progress', 'completed', 'reviewing', 'disputed'];
        if (job.status === 'open' || job.status === 'pending') {
            return errorResponse(res, 'Chat is only enabled after a worker is assigned to the job.', 403);
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
            .populate('job', 'job_title status dispute');

        return successResponse(res, 'Chat initiated successfully', populatedChat, 201);
    } catch (error) {
        console.error('Error initiating chat:', error);
        return errorResponse(res, 'Server error', 500);
    }
};

// Initiate Project Group Chat (Phase 5)
exports.initiateProjectGroupChat = async (req, res) => {
    try {
        const { jobId } = req.body;
        const senderId = req.user.id; // Contractor

        if (!jobId) {
            return errorResponse(res, 'Job ID is required', 400);
        }

        const Job = require('../jobs/job.model');
        const job = await Job.findById(jobId);
        if (!job) {
            return errorResponse(res, 'Job not found', 404);
        }

        // Constraint: Chat only enabled after job assignment (Phase 5 Constraint)
        const allowedStatuses = ['assigned', 'in_progress', 'completed', 'reviewing', 'disputed'];
        if (!allowedStatuses.includes(job.status)) {
            return errorResponse(res, 'Group chat is only enabled after workers are assigned to the project.', 403);
        }

        // 1. Identify all participants: Contractor + All assigned workers across all tasks
        const participantsSet = new Set();
        participantsSet.add(senderId.toString());

        if (job.selected_worker_id) {
            participantsSet.add(job.selected_worker_id.toString());
        }

        if (job.tasks && job.tasks.length > 0) {
            job.tasks.forEach(task => {
                if (task.assigned_worker_id) {
                    participantsSet.add(task.assigned_worker_id.toString());
                }
            });
        }

        const participantIds = Array.from(participantsSet);

        // Constraint: Must have at least one worker to start a group chat
        if (participantIds.length < 2) {
            return errorResponse(res, 'No workers assigned to this project yet. Assign workers to start a group chat.', 400);
        }

        // A group chat must have at least the contractor but usually needs workers to be "group-worthy"
        // Though technically it can be a group of 1 contractor + 1 worker too if requested as group type.
        
        // 2. Check if group chat already exists for this job
        let chat = await Chat.findOne({
            job: jobId,
            type: 'group'
        });

        if (chat) {
            // Update participants if they changed (new workers assigned)
            chat.participants = participantIds;
            chat.status = 'active';

            // Ensure all participants have an entry in unreadCounts
            participantIds.forEach(pId => {
                if (!chat.unreadCounts.has(pId)) {
                    chat.unreadCounts.set(pId, 0);
                }
            });

            await chat.save();
            chat = await Chat.findById(chat._id)
                .populate('participants', 'name profileImage role')
                .populate('job', 'job_title status dispute');
            return successResponse(res, 'Group chat retrieved successfully', chat);
        }

        // 3. Create new group chat
        const unreadCounts = {};
        participantIds.forEach(pId => { unreadCounts[pId] = 0; });

        const newChat = await Chat.create({
            participants: participantIds,
            job: jobId,
            type: 'group',
            unreadCounts: unreadCounts
        });

        const populatedChat = await Chat.findById(newChat._id)
            .populate('participants', 'name profileImage role')
            .populate('job', 'job_title status dispute');

        return successResponse(res, 'Project group chat created successfully', populatedChat, 201);
    } catch (error) {
        console.error('Error initiating group chat:', error);
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
            .populate({
                path: 'participants',
                select: 'name profileImage role',
                match: { _id: { $ne: userId } }
            })
            .populate({
                path: 'job',
                select: 'job_title status dispute'
            })
            .sort({ lastMessageTime: -1 });

        // A chat is only "valid" if it has participants other than the current user (standard professional chat logic)
        // Group chats will have multiple other participants.
        const validChats = chats.filter(chat => chat.participants && chat.participants.length > 0);

        return successResponse(res, 'Chats retrieved successfully', validChats);
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
