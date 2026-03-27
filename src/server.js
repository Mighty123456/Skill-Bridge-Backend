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
      // Do not exit process in production to prevent Render from crashing completely 
      // on minor background task connection drops (like Redis or DB ping failures)
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message}`);
      // Allow the process to continue running so Render doesn't throw a status 1 permanently. 
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
  }
};

// Start the server
startServer();

// Server logic successfully running




