const cloudinary = require('../../config/cloudinary.config');
const logger = require('../../config/logger');

/**
 * Upload image to Cloudinary
 * @param {Buffer|String} file - File buffer or file path
 * @param {String} folder - Cloudinary folder path
 * @param {Object} options - Additional options (width, height, format, etc.)
 * @returns {Promise<Object>} Upload result with URL and public_id
 */
const uploadImage = async (file, folder = 'skillbridge', options = {}) => {
  try {
    const uploadOptions = {
      folder: folder,
      resource_type: 'image',
      ...options,
    };

    // If file is a buffer (from multer)
    if (Buffer.isBuffer(file)) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              logger.error(`Cloudinary upload error: ${error.message}`);
              reject(new Error('Failed to upload image to Cloudinary'));
            } else {
              logger.info(`Image uploaded successfully: ${result.public_id}`);
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
                width: result.width,
                height: result.height,
                format: result.format,
              });
            }
          }
        );

        uploadStream.end(file);
      });
    } else {
      // If file is a path string
      const result = await cloudinary.uploader.upload(file, uploadOptions);
      return {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    }
  } catch (error) {
    logger.error(`Cloudinary upload error: ${error.message}`);
    throw new Error('Failed to upload image');
  }
};

/**
 * Delete image from Cloudinary
 * @param {String} publicId - Cloudinary public ID
 * @returns {Promise<Object>} Deletion result
 */
const deleteImage = async (publicId) => {
  try {
    if (!publicId) {
      return { success: true, message: 'No image to delete' };
    }

    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result === 'ok') {
      logger.info(`Image deleted successfully: ${publicId}`);
      return { success: true, message: 'Image deleted successfully' };
    } else {
      logger.warn(`Image deletion result: ${result.result} for ${publicId}`);
      return { success: false, message: 'Image not found or already deleted' };
    }
  } catch (error) {
    logger.error(`Cloudinary delete error: ${error.message}`);
    throw new Error('Failed to delete image');
  }
};

/**
 * Upload image with automatic optimization
 * @param {Buffer} file - File buffer
 * @param {String} folder - Cloudinary folder
 * @param {Number} maxWidth - Maximum width (optional)
 * @param {Number} maxHeight - Maximum height (optional)
 * @returns {Promise<Object>} Upload result
 */
const uploadOptimizedImage = async (file, folder = 'skillbridge', maxWidth = 1200, maxHeight = 1200) => {
  const options = {
    transformation: [
      {
        width: maxWidth,
        height: maxHeight,
        crop: 'limit',
        quality: 'auto',
        fetch_format: 'auto',
      },
    ],
  };

  return uploadImage(file, folder, options);
};

/**
 * Upload profile image with specific settings
 * @param {Buffer} file - File buffer
 * @param {String} userId - User ID for folder organization
 * @returns {Promise<Object>} Upload result
 */
const uploadProfileImage = async (file, userId) => {
  const folder = `skillbridge/profiles/${userId}`;
  
  const options = {
    transformation: [
      {
        width: 400,
        height: 400,
        crop: 'fill',
        gravity: 'face',
        quality: 'auto',
        fetch_format: 'auto',
      },
    ],
  };

  return uploadImage(file, folder, options);
};

/**
 * Extract public ID from Cloudinary URL
 * @param {String} url - Cloudinary URL
 * @returns {String|null} Public ID or null
 */
const extractPublicId = (url) => {
  if (!url) return null;
  
  try {
    // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{version}/{public_id}.{format}
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
    return match ? match[1] : null;
  } catch (error) {
    logger.error(`Error extracting public ID: ${error.message}`);
    return null;
  }
};

module.exports = {
  uploadImage,
  deleteImage,
  uploadOptimizedImage,
  uploadProfileImage,
  extractPublicId,
};

