const logger = require('../../config/logger');

// Lazy-load Firebase Admin to avoid crashing if credentials are not set
let admin = null;

/**
 * Initializes Firebase Admin SDK.
 * Call this once at server startup.
 */
const initializeFCM = () => {
    try {
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

        if (!serviceAccountJson) {
            logger.warn('⚠️  FCM: FIREBASE_SERVICE_ACCOUNT_JSON not set. Push notifications will be disabled.');
            return false;
        }

        const serviceAccount = JSON.parse(serviceAccountJson);

        // Prevent re-initialization if already done
        admin = require('firebase-admin');
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            logger.info('✅ Firebase Admin SDK initialized. Push notifications are live!');
        } else {
            logger.info('ℹ️  Firebase Admin SDK already initialized.');
        }
        return true;
    } catch (err) {
        logger.error(`❌ FCM Initialization Error: ${err.message}`);
        return false;
    }
};

/**
 * Sends a push notification to one or more FCM tokens.
 *
 * @param {string | string[]} tokens - A single FCM token or an array of tokens.
 * @param {object} notification - { title: string, body: string }
 * @param {object} data - Optional key-value payload for the Flutter app (e.g., { type: 'job_alert', jobId: '...' })
 * @param {string} collapseKey - Optional. Replaces old notification on device (like aggregation). e.g. 'job_123_quotes'
 */
const sendPushNotification = async (tokens, notification, data = {}, collapseKey = null) => {
    if (!admin) {
        logger.warn('FCM: Skipping push – Firebase Admin not initialized.');
        return { success: false, reason: 'fcm_not_initialized' };
    }

    if (!tokens || (Array.isArray(tokens) && tokens.length === 0)) {
        logger.info('FCM: No tokens provided for push notification. Skipping.');
        return { success: false, reason: 'no_tokens' };
    }

    // Normalize to array
    const tokenArray = Array.isArray(tokens) ? tokens : [tokens];

    // FCM data values must ALL be strings
    const stringifiedData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    // CRITICAL: Always include click_action for Flutter handlers to wake up
    if (!stringifiedData.click_action) {
        stringifiedData.click_action = 'FLUTTER_NOTIFICATION_CLICK';
    }

    const message = {
        notification: {
            title: notification.title,
            body: notification.body,
        },
        data: stringifiedData,
        android: {
            priority: 'high',
            notification: {
                sound: 'default',
                channelId: 'skillbridge_main_channel',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                // collapseKey causes a new notification to REPLACE the previous one with the same key
                ...(collapseKey && { tag: collapseKey }),
            },
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                    mutableContent: true,
                    contentAvailable: true,
                    ...(collapseKey && { 'thread-id': collapseKey }),
                },
            },
            headers: {
                'apns-priority': '10', // High priority for APNS
            }
        },
        tokens: tokenArray,
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        logger.info(`FCM: Sent ${response.successCount}/${tokenArray.length} messages successfully.`);

        // Collect invalid tokens to remove from DB
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                const errCode = resp.error?.code;
                // These codes mean the token is stale/invalid and should be removed
                if (
                    errCode === 'messaging/invalid-registration-token' ||
                    errCode === 'messaging/registration-token-not-registered'
                ) {
                    invalidTokens.push(tokenArray[idx]);
                }
                logger.warn(`FCM: Failed for token [${idx}]: ${resp.error?.message}`);
            }
        });

        return {
            success: response.successCount > 0,
            successCount: response.successCount,
            failureCount: response.failureCount,
            invalidTokens, // Caller can use this to clean up the DB
        };
    } catch (err) {
        logger.error(`FCM: Error sending multicast message: ${err.message}`);
        return { success: false, error: err.message };
    }
};

module.exports = {
    initializeFCM,
    sendPushNotification,
};
