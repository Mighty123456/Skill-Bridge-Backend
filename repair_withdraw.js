/**
 * repair_withdraw.js
 * 
 * One-time repair: finds all withdrawals where the wallet was debited
 * but the balance was never returned (failed/rejected with refunded=false).
 * 
 * Run with: node repair_withdraw.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./src/config/env');

async function repairWithdrawals() {
    await mongoose.connect(config.MONGODB_URI || config.DB_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const Withdrawal = require('./src/modules/wallet/withdrawal.model');
    const Wallet = require('./src/modules/wallet/wallet.model');

    // Find withdrawals that are failed/rejected but NOT marked as refunded.
    // These are wallets that were debited but money never came back.
    const unrefunded = await Withdrawal.find({
        status: { $in: ['failed', 'rejected'] },
        refunded: { $ne: true }
    }).populate('user', 'name email');

    if (unrefunded.length === 0) {
        console.log('✅ No unrefunded withdrawals found. All balances are correct!');
        await mongoose.disconnect();
        return;
    }

    console.log(`⚠️  Found ${unrefunded.length} withdrawal(s) with debited but unrestored balance:\n`);

    for (const wd of unrefunded) {
        const userId = wd.user?._id || wd.user;
        const userName = wd.user?.name || userId;
        const userEmail = wd.user?.email || '';

        console.log(`  Withdrawal ID : ${wd._id}`);
        console.log(`  User          : ${userName} (${userEmail})`);
        console.log(`  Amount        : ₹${wd.amount}`);
        console.log(`  Status        : ${wd.status}`);
        console.log(`  Failure Reason: ${wd.failureReason || wd.rejectionReason || 'N/A'}`);
        console.log(`  retryCount    : ${wd.retryCount}`);
        console.log(`  Created At    : ${wd.createdAt}`);

        // Credit the wallet back
        const wallet = await Wallet.findOneAndUpdate(
            { user: userId },
            { $inc: { balance: wd.amount } },
            { new: true }
        );

        if (wallet) {
            console.log(`  ✅ Credited ₹${wd.amount} back. New balance: ₹${wallet.balance}`);
        } else {
            console.log(`  ❌ Wallet NOT found for user ${userId} — manual action required!`);
        }

        // Mark as refunded so future CRON runs don't credit again
        wd.refunded = true;
        wd.rejectionReason = (wd.rejectionReason || '') + ' [Repaired by repair_withdraw.js]';
        if (wd.status === 'failed') wd.status = 'rejected'; // finalize it
        await wd.save();

        console.log(`  ✅ Marked withdrawal ${wd._id} as refunded=true\n`);
    }

    console.log(`\n🔧 Repair complete. ${unrefunded.length} withdrawal(s) fixed.`);
    await mongoose.disconnect();
}

repairWithdrawals().catch(err => {
    console.error('❌ Repair failed:', err.message);
    process.exit(1);
});
