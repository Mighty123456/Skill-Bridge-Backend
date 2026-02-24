const express = require('express');
const router = express.Router();
const { authenticate: protect } = require('../../common/middleware/auth.middleware');
const User = require('./user.model');
const logger = require('../../config/logger');

/**
 * @route   POST /api/users/fcm-token
 * @desc    Save or update the FCM token for the logged-in user's device.
 *          Flutter calls this after login and whenever the token refreshes.
 * @access  Private (requires JWT)
 */
router.post('/fcm-token', protect, async (req, res) => {
    try {
        const { token } = req.body;

        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, message: 'A valid FCM token string is required.' });
        }

        // Add token to the array ONLY if it doesn't already exist (prevents duplicates)
        await User.findByIdAndUpdate(req.user._id, {
            $addToSet: { fcmTokens: token },
        });

        logger.info(`FCM: Token saved for user ${req.user._id}`);
        return res.json({ success: true, message: 'FCM token saved successfully.' });
    } catch (err) {
        logger.error(`FCM Token Save Error: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Server error saving FCM token.' });
    }
});

/**
 * @route   DELETE /api/users/fcm-token
 * @desc    Remove a specific FCM token (called on logout to stop push notifications).
 * @access  Private (requires JWT)
 */
router.delete('/fcm-token', protect, async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ success: false, message: 'FCM token is required.' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $pull: { fcmTokens: token },
        });

        logger.info(`FCM: Token removed for user ${req.user._id}`);
        return res.json({ success: true, message: 'FCM token removed successfully.' });
    } catch (err) {
        logger.error(`FCM Token Remove Error: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Server error removing FCM token.' });
    }
});

module.exports = router;
