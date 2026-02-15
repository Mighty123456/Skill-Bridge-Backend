const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../config/logger');
const Chat = require('../modules/chat/chat.model');
const Message = require('../modules/chat/message.model');

let io;

const initializeSocket = (server) => {
    io = socketIo(server, {
        cors: {
            origin: "*", // Adjust for production
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next) => {
        if (socket.handshake.query && socket.handshake.query.token) {
            jwt.verify(socket.handshake.query.token, config.JWT_SECRET, (err, decoded) => {
                if (err) return next(new Error('Authentication error'));
                socket.decoded = decoded;
                next();
            });
        } else {
            next(new Error('Authentication error'));
        }
    });

    // Track connected users for online status
    const connectedUsers = new Set();

    io.on('connection', (socket) => {
        const userId = socket.decoded.id;
        logger.info(`Socket connected: ${socket.id} (User: ${userId})`);

        connectedUsers.add(userId);

        // Broadcast that user is online
        io.emit('user_status_change', { userId, status: 'online' });

        // Join a personal room for notifications
        socket.join(userId);

        // Join a specific chat room
        socket.on('join_chat', (chatId) => {
            socket.join(chatId);
            logger.info(`User ${userId} joined chat: ${chatId}`);

            // Optional: When joining a chat, we could also emit that the user is now active in THIS specific chat
            // to support the "blue tick" logic if they read existing messages.
        });

        socket.on('leave_chat', (chatId) => {
            socket.leave(chatId);
            logger.info(`User ${userId} left chat: ${chatId}`);
        });

        // Handle new message
        socket.on('send_message', async (data) => {
            try {
                const { chatId, text, recipientId, encrypted } = data;

                // 1. Save to DB
                // We check if recipient is currently connected to mark as 'delivered'
                const isRecipientConnected = connectedUsers.has(recipientId);

                const newMessage = await Message.create({
                    chatId,
                    senderId: userId,
                    text: text,
                    isEncrypted: encrypted || false,
                    deliveredTo: isRecipientConnected ? [recipientId] : []
                });

                // 2. Update Chat
                await Chat.findByIdAndUpdate(chatId, {
                    lastMessage: text,
                    lastMessageTime: Date.now(),
                    $inc: { [`unreadCounts.${recipientId}`]: 1 }
                });

                // 3. Emit to Room
                io.to(chatId).emit('receive_message', newMessage);

            } catch (e) {
                logger.error(`Socket message error: ${e.message}`);
                socket.emit('error', 'Failed to send message');
            }
        });

        socket.on('disconnect', () => {
            connectedUsers.delete(userId);
            logger.info(`Socket disconnected: ${socket.id} (User: ${userId})`);

            // Broadcast that user is offline with last seen
            io.emit('user_status_change', {
                userId,
                status: 'offline',
                lastSeen: new Date()
            });
        });
    });
};

const getIo = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

module.exports = { initializeSocket, getIo };
