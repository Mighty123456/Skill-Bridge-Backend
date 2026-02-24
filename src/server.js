const app = require('./app');
const connectDB = require('./config/db');
const config = require('./config/env');
const logger = require('./config/logger');
const { initializeEmailService } = require('./common/services/email.service');
const { initializeFCM } = require('./common/services/fcm.service');

const http = require('http');
const { initializeSocket } = require('./socket/socket');
const { initializeScheduler } = require('./common/services/scheduler.service');
const { initializeQueues } = require('./common/services/queue.service');

// Start server function
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();

    // Initialize email service on startup
    logger.info('📧 Initializing email service...');
    await initializeEmailService();

    // Initialize Firebase Cloud Messaging (FCM) for push notifications
    logger.info('🔔 Initializing FCM push notification service...');
    initializeFCM();

    // Start server only after DB is connected
    const PORT = config.PORT;

    // Create HTTP server from Express app
    const server = http.createServer(app);

    // Initialize Socket.io
    initializeSocket(server);

    // Initialize Background Queues
    initializeQueues();

    // Start background tasks
    initializeScheduler();

    server.listen(PORT, () => {
      logger.info(`🚀 Server is soaring! Running in ${config.NODE_ENV} mode on port ${PORT}`);
      logger.info(`🔗 API URL: http://localhost:${PORT}/api`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error(`Unhandled Rejection: ${err.message}`);
      server.close(() => {
        process.exit(1);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message}`);
      process.exit(1);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

// Start the server
startServer();

// Server logic successfully running




