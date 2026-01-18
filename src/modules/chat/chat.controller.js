const Chat = require('./chat.model');
const Message = require('./message.model');
const { successResponse, errorResponse } = require('../../common/utils/response');

// Initiate (or get existing) chat
exports.initiateChat = async (req, res) => {
    try {
        const { recipientId } = req.body;
        const senderId = req.user.id;

        if (!recipientId) {
            return errorResponse(res, 'Recipient ID is required', 400);
        }

        // Check if chat exists
        let chat = await Chat.findOne({
            participants: { $all: [senderId, recipientId] }
        });

        if (chat) {
            chat = await Chat.findById(chat._id).populate('participants', 'name profileImage role');
            return successResponse(res, 'Chat retrieved successfully', chat);
        }

        // Create new chat
        const newChat = await Chat.create({
            participants: [senderId, recipientId],
            unreadCounts: {
                [senderId]: 0,
                [recipientId]: 0
            }
        });

        const populatedChat = await Chat.findById(newChat._id).populate('participants', 'name profileImage role');
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

        const chat = await Chat.findById(chatId);
        if (!chat) {
            return errorResponse(res, 'Chat not found', 404);
        }

        const message = await Message.create({
            chatId,
            senderId,
            text,
            readBy: [senderId]
        });

        // Update Chat
        chat.lastMessage = text;
        chat.lastMessageTime = Date.now();

        // Increment unread count for others
        chat.participants.forEach(pId => {
            if (pId.toString() !== senderId) {
                const currentCount = chat.unreadCounts.get(pId.toString()) || 0;
                chat.unreadCounts.set(pId.toString(), currentCount + 1);
            }
        });

        await chat.save();

        // Emit via socket
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

        // Reset unread count for this user
        const chat = await Chat.findById(chatId);
        if (chat) {
            // If unreadCounts is not set (legacy), init it
            if (!chat.unreadCounts) { chat.unreadCounts = new Map(); }

            if (chat.unreadCounts.get(userId) > 0) {
                chat.unreadCounts.set(userId, 0);
                await chat.save();
            }
        }

        return successResponse(res, 'Messages retrieved', messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        return errorResponse(res, 'Server error', 500);
    }
}
