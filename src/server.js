const app = require('./app');
const connectDB = require('./config/db');
const config = require('./config/env');
const logger = require('./config/logger');
const { initializeEmailService } = require('./common/services/email.service');

// Start server function
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();

    // Initialize email service on startup
    logger.info('📧 Initializing email service...');
    await initializeEmailService();

    // Start server only after DB is connected
    const PORT = config.PORT;
    const server = app.listen(PORT, () => {
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

