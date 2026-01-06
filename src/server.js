const app = require('./app');
const connectDB = require('./config/db');
const config = require('./config/env');
const logger = require('./config/logger');

// Start server function
const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();

    // Start server only after DB is connected
    const PORT = config.PORT;
    const server = app.listen(PORT, () => {
      logger.info(`Server running in ${config.NODE_ENV} mode on port ${PORT}`);
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

