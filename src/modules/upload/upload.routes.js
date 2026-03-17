
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
        const allowedMimeTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/quicktime',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain'
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type! Only images, videos, and standard documents (PDF, DOCX, TXT) are allowed.'), false);
        }
    }
});

// Protect all upload routes
router.post('/', protect, upload.single('file'), uploadController.uploadFile);
router.delete('/', protect, uploadController.deleteFile); // Expects { "url": "..." }

module.exports = router;
