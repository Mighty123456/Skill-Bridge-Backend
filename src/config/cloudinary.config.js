const cloudinary = require('cloudinary').v2;
const config = require('./env');
const logger = require('./logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
});

// Test Cloudinary connection
if (config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET) {
  cloudinary.api.ping((error, result) => {
    if (error) {
      logger.warn(`Cloudinary connection test failed: ${error.message}`);
    } else {
      logger.info('Cloudinary configured successfully');
    }
  });
} else {
  logger.warn('Cloudinary credentials not configured. Image upload will be disabled.');
}

module.exports = cloudinary;

