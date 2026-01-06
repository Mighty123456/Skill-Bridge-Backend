const mongoose = require('mongoose');
const config = require('./env');
const logger = require('./logger');

const connectDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      logger.info('MongoDB already connected');
      return;
    }

    const conn = await mongoose.connect(config.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    // Don't exit process in serverless environment
    if (process.env.VERCEL) {
      throw error;
    }
    process.exit(1);
  }
};

module.exports = connectDB;

