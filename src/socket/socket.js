const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../config/logger');
const Chat = require('../modules/chat/chat.model');
const Message = require('../modules/chat/message.model');
const Job = require('../modules/jobs/job.model');
const chatService = require('../modules/chat/chat.service');

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

        // ✅ AUTO-DELIVER: Mark all undelivered messages for this user as 'delivered'
        const markDelivered = async () => {
            try {
                // Find messages where this user is a participant but hasn't had the message delivered
                const userChats = await Chat.find({ participants: userId });
                const chatIds = userChats.map(c => c._id);

                const undeliveredMessages = await Message.find({
                    chatId: { $in: chatIds },
                    senderId: { $ne: userId },
                    deliveredTo: { $ne: userId }
                });

                if (undeliveredMessages.length > 0) {
                    await Message.updateMany(
                        { _id: { $in: undeliveredMessages.map(m => m._id) } },
                        { $addToSet: { deliveredTo: userId } }
                    );

                    // Notify rooms
                    chatIds.forEach(cId => {
                        io.to(cId.toString()).emit('messages_delivered', {
                            chatId: cId,
                            deliveredTo: userId
                        });
                    });
                }
            } catch (err) {
                logger.error(`Error marking delivered: ${err.message}`);
            }
        };
        markDelivered();

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
            const chatIdStr = chatId.toString();
            socket.leave(chatIdStr);
            logger.info(`User ${userId} left chat: ${chatIdStr}`);
        });

        // ✅ Mark Messages as Read
        socket.on('mark_read', async (data) => {
            try {
                const { chatId } = data;
                const chatIdStr = chatId.toString();

                // Find unread messages in this chat sent by the OTHER person
                const unreadMessages = await Message.find({
                    chatId: chatIdStr,
                    senderId: { $ne: userId },
                    readBy: { $ne: userId }
                });

                if (unreadMessages.length > 0) {
                    const messageIds = unreadMessages.map(m => m._id);
                    await Message.updateMany(
                        { _id: { $in: messageIds } },
                        { $addToSet: { readBy: userId, deliveredTo: userId } }
                    );

                    // Update unread count
                    await Chat.findByIdAndUpdate(chatIdStr, {
                        $set: { [`unreadCounts.${userId}`]: 0 }
                    });

                    // Broadcast to the room so sender sees blue ticks
                    io.to(chatIdStr).emit('messages_read', {
                        chatId: chatIdStr,
                        messageIds: messageIds,
                        readBy: userId
                    });
                }
            } catch (e) {
                logger.error(`Socket mark_read error: ${e.message}`);
            }
        });

        // --- Real-time Location Tracking ---
        socket.on('join_job_tracking', (jobId) => {
            socket.join(`job_${jobId}`);
            logger.info(`User ${userId} tracking job: ${jobId}`);
        });

        socket.on('leave_job_tracking', (jobId) => {
            socket.leave(`job_${jobId}`);
            logger.info(`User ${userId} stopped tracking job: ${jobId}`);
        });



        socket.on('update_location', async (data) => {
            const { jobId, lat, lng, heading } = data;

            // Broadcast to everyone tracking this job (except sender)
            socket.to(`job_${jobId}`).emit('location_update', { lat, lng, heading });

            // Persist to DB so Admin Map (polling) sees the update
            try {
                if (jobId && lat && lng) {
                    await Job.findByIdAndUpdate(jobId, {
                        $set: {
                            'journey.worker_location': { lat, lng },
                            'journey.last_location_update': new Date()
                        }
                    });
                }
            } catch (err) {
                logger.error(`Location save error: ${err.message}`);
            }
        });

        // Handle new message
        socket.on('send_message', async (data) => {
            try {
                const { chatId, text, recipientId, encrypted, media } = data;

                const { message, systemMessage } = await chatService.processAndSendMessage({
                    chatId,
                    senderId: userId,
                    text,
                    media,
                    isEncrypted: encrypted || false
                });

                const chatIdStr = chatId.toString();

                // Emit to Room (Sender + Recipient)
                io.to(chatIdStr).emit('receive_message', message.toObject());

                // Inject System Warning if triggered
                if (systemMessage) {
                    io.to(chatIdStr).emit('receive_message', systemMessage.toObject());
                }

            } catch (e) {
                logger.error(`Socket message error: ${e.message}`);
                socket.emit('error', e.message || 'Failed to send message');
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
