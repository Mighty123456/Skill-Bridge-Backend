
const cloudinaryService = require('../../common/services/cloudinary.service');
const logger = require('../../config/logger');

/**
 * Upload a single file
 */
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const folder = req.body.folder || 'skillbridge/uploads';
        const result = await cloudinaryService.uploadOptimizedImage(req.file.buffer, folder);

        res.status(200).json({
            success: true,
            message: 'File uploaded successfully',
            data: {
                url: result.url,
                publicId: result.publicId
            }
        });
    } catch (error) {
        logger.error(`Upload Controller Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'File upload failed' });
    }
};

/**
 * Delete a file
 */
exports.deleteFile = async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, message: 'URL is required' });
        }

        // Extract public ID from URL using service helper
        const publicId = cloudinaryService.extractPublicId(url);
        if (!publicId) {
            return res.status(400).json({ success: false, message: 'Invalid Cloudinary URL' });
        }

        await cloudinaryService.deleteImage(publicId);

        res.status(200).json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        logger.error(`Delete File Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'File deletion failed' });
    }
};
