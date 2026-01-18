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

    io.on('connection', (socket) => {
        logger.info(`Socket connected: ${socket.id} (User: ${socket.decoded.id})`);

        // Join a personal room for notifications
        socket.join(socket.decoded.id);

        // Join a specific chat room
        socket.on('join_chat', (chatId) => {
            socket.join(chatId);
            logger.info(`User ${socket.decoded.id} joined chat: ${chatId}`);
        });

        socket.on('leave_chat', (chatId) => {
            socket.leave(chatId);
            logger.info(`User ${socket.decoded.id} left chat: ${chatId}`);
        });

        // Handle new message
        socket.on('send_message', async (data) => {
            try {
                const { chatId, text, recipientId, encrypted } = data; // Expecting 'text' to be encrypted string

                // NOTE: We trust the client to have encrypted 'text' if 'encrypted' flag is true.
                // Even if not, we treat 'text' as the payload to save.

                // 1. Save to DB
                const newMessage = await Message.create({
                    chatId,
                    senderId: socket.decoded.id,
                    text: text, // Saved as is (encrypted string)
                    isEncrypted: encrypted || false // Flag to know if we need to decrypt on client
                });

                // 2. Update Chat
                await Chat.findByIdAndUpdate(chatId, {
                    lastMessage: text, // Show encrypted text in preview? Or "Encrypted Message"
                    lastMessageTime: Date.now(),
                    $inc: { [`unreadCounts.${recipientId}`]: 1 }
                });

                // 3. Emit to Room (Sender and Recipient if in room)
                io.to(chatId).emit('receive_message', newMessage);

                // 4. Notification (if recipient not in room?) - Optional for now

            } catch (e) {
                logger.error(`Socket message error: ${e.message}`);
                socket.emit('error', 'Failed to send message');
            }
        });

        socket.on('disconnect', () => {
            logger.info(`Socket disconnected: ${socket.id}`);
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
