const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        const User = require('./src/modules/users/user.model');
        const users = await User.find({ fcmTokens: { $exists: true, $not: { $size: 0 } } });
        console.log('--- ACTIVE NOTIFICATION DEVICES ---');
        if (users.length === 0) {
            console.log('No devices registered. Please log in on the mobile app.');
        } else {
            users.forEach(u => {
                console.log(`User: ${u.name} | Role: ${u.role} | Tokens: ${u.fcmTokens.length}`);
            });
        }
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
