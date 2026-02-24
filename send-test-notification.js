const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { initializeFCM, sendPushNotification } = require('./src/common/services/fcm.service');
const User = require('./src/modules/users/user.model');

dotenv.config();

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        if (!initializeFCM()) {
            console.error('❌ Failed to initialize FCM');
            process.exit(1);
        }

        // Find user with FCM tokens
        const user = await User.findOne({ fcmTokens: { $exists: true, $not: { $size: 0 } } });

        if (!user) {
            console.error('❌ No users found with active tokens. Please login on the mobile app first.');
            process.exit(1);
        }

        console.log(`🚀 Sending test notification to ${user.name} (${user.role})...`);
        console.log(`📱 Destination: ${user.fcmTokens.length} device(s)`);

        const result = await sendPushNotification(
            user.fcmTokens,
            {
                title: 'SkillBridge Test 🔔',
                body: `Hello ${user.name}! Your push notifications are working now.`,
            },
            {
                type: 'test_ping',
                timestamp: new Date().toISOString(),
                recipientRole: user.role,
                click_action: 'FLUTTER_NOTIFICATION_CLICK', // Help legacy handlers
            }
        );

        console.log('\n--- FCM RESULT ---');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('\n✅ TEST SENT SUCCESSFULLY! Check your phone.');
        } else {
            console.log('\n❌ FAILED to send. Check logs above.');
        }

        process.exit(0);
    } catch (err) {
        console.error('💥 ERROR:', err);
        process.exit(1);
    }
}

run();
