
const express = require('express');
const multer = require('multer');
const router = express.Router();
const uploadController = require('./upload.controller');
const { authenticate: protect } = require('../../common/middleware/auth.middleware');


// Multer config for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image and video files are allowed!'), false);
        }
    }
});

// Protect all upload routes
router.post('/', protect, upload.single('file'), uploadController.uploadFile);
router.delete('/', protect, uploadController.deleteFile); // Expects { "url": "..." }

module.exports = router;
