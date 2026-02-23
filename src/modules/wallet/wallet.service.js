const Wallet = require('./wallet.model');
const mongoose = require('mongoose');
const Withdrawal = require('./withdrawal.model');
const NotificationService = require('../notifications/notification.service');

/**
 * Get or create wallet for a user
 */
exports.getWallet = async (userId) => {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
        wallet = await Wallet.create({ user: userId });
    } else {
        // Auto-check for released funds
        await this.checkAndReleasePending(userId);
        wallet = await Wallet.findOne({ user: userId }); // Reload
    }
    return wallet;
};

/**
 * Check and Release Pending Funds
 */
exports.checkAndReleasePending = async (userId) => {
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet || !wallet.pendingPayouts || wallet.pendingPayouts.length === 0) return;

    const now = new Date();
    let releasedAmount = 0;
    const remainingPayouts = [];

    for (const payout of wallet.pendingPayouts) {
        if (payout.releaseAt <= now) {
            releasedAmount += payout.amount;
        } else {
            remainingPayouts.push(payout);
        }
    }

    if (releasedAmount > 0) {
        wallet.balance += releasedAmount;
        wallet.pendingBalance = Math.max(0, wallet.pendingBalance - releasedAmount);
        wallet.pendingPayouts = remainingPayouts;
        await wallet.save();
        // Send Notification
        await NotificationService.createNotification({
            recipient: userId,
            title: 'Funds Available!',
            message: `₹${releasedAmount.toFixed(2)} has been released and is now available in your balance.`,
            type: 'payment',
            data: { type: 'payout_released' }
        });
        // logger.info(`Released ₹${releasedAmount} pending funds for user ${userId}`);
    }
};

/**
 * Credit amount to wallet
 */
exports.creditWallet = async (userId, amount, session = null) => {
    const opts = session ? { session } : {};
    const updatedWallet = await Wallet.findOneAndUpdate(
        { user: userId },
        { $inc: { balance: amount } },
        { new: true, upsert: true, ...opts }
    );

    // Send Notification
    await NotificationService.createNotification({
        recipient: userId,
        title: 'Wallet Topped Up!',
        message: `₹${amount.toFixed(2)} has been added to your wallet.`,
        type: 'payment',
        data: { type: 'topup_success', amount }
    }).catch(err => logger.error(`Failed to send topup notification: ${err.message}`));

    return updatedWallet;
};

/**
 * Debit amount from wallet
 */
exports.debitWallet = async (userId, amount, session = null) => {
    const opts = session ? { session } : {};
    const wallet = await Wallet.findOne({ user: userId }).session(session); // Add session here for read too if strictly consistent

    if (!wallet) {
        throw new Error('Wallet not found');
    }
    if (wallet.balance < amount) {
        throw new Error(`Insufficient funds. Available: ${wallet.balance}, Required: ${amount}`);
    }

    wallet.balance -= amount;
    return await wallet.save(opts);
};

/**
 * Get Platform Wallet (Singleton-ish)
 * We'll use a specific ID or query for a system user. 
 * For now, let's assume there's a specific Admin User or we create a float wallet.
 * To keep it simple, we will just use a specific string ID for platform wallet if Mongoose allows, 
 * or better, we create an admin user seed.
 * 
 * Alternative: Pass a specific 'type' to wallet model? 
 * The current model checks for 'user' ref. 
 * I will skip creating a specific Platform Wallet Model for now and just rely on 'user' reference.
 * The requester can handle platform wallet ID.
 */
/**
 * Get Platform Wallet (Singleton)
 */
exports.getPlatformWallet = async () => {
    let wallet = await Wallet.findOne({ type: 'platform' });
    if (!wallet) {
        wallet = await Wallet.create({ type: 'platform', balance: 0, escrowBalance: 0 });
    }
    return wallet;
};

/**
 * Credit Revenue to Platform Wallet
 */
exports.creditPlatformRevenue = async (amount, session = null) => {
    const opts = session ? { session } : {};
    return await Wallet.findOneAndUpdate(
        { type: 'platform' },
        { $inc: { balance: amount } },
        { new: true, upsert: true, setDefaultsOnInsert: true, ...opts }
    );
};

/**
 * Request Withdrawal
 */
exports.requestWithdrawal = async (userId, amount, type = 'standard', bankDetails) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const wallet = await Wallet.findOne({ user: userId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        if (wallet.balance < amount) {
            throw new Error(`Insufficient funds. Available: ₹${wallet.balance}`);
        }

        // Fee Logic
        let fee = 0;
        if (type === 'instant') {
            fee = Math.max(10, Math.round(amount * 0.02)); // 2% or min ₹10
        }

        const netAmount = amount - fee;
        if (netAmount <= 0) throw new Error('Amount too low to cover fees');

        // Debit Wallet
        wallet.balance -= amount;
        await wallet.save({ session });

        // Create Withdrawal Record
        const withdrawal = new Withdrawal({
            user: userId,
            amount,
            fee,
            netAmount,
            type,
            bankDetails,
            status: 'pending' // Admin needs to approve or auto-process via payout gateway
        });

        await withdrawal.save({ session });

        // Send withdrawal request email (async)
        const EmailService = require('../../common/services/email.service');
        const User = require('mongoose').model('User');
        const user = await User.findById(userId).select('name email').lean();
        if (user && user.email) {
            EmailService.sendWithdrawalStatusEmail(user.email, {
                userName: user.name,
                amount: amount,
                status: 'pending',
                notes: 'Your withdrawal request has been received and is being processed.'
            }).catch(err => logger.error(`Failed to send withdrawal email: ${err.message}`));
        }

        // Send App Notification
        await NotificationService.createNotification({
            recipient: userId,
            title: 'Withdrawal Requested',
            message: `Your request for ₹${amount.toFixed(2)} has been received.`,
            type: 'payment',
            data: { withdrawalId: withdrawal._id, status: 'pending' }
        });

        await session.commitTransaction();
        return withdrawal;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

exports.getWithdrawalHistory = async (userId) => {
    return await Withdrawal.find({ user: userId }).sort({ createdAt: -1 });
};

/**
 * ADMIN: Get All Withdrawals
 */
exports.getAllWithdrawals = async (filters = {}) => {
    return await Withdrawal.find(filters)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 });
};

/**
 * ADMIN: Process Withdrawal (Approve/Reject)
 */
exports.processWithdrawal = async (withdrawalId, adminId, status, notes) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
        if (!withdrawal) throw new Error('Withdrawal request not found');
        if (withdrawal.status !== 'pending') throw new Error('Withdrawal already processed');

        withdrawal.status = status; // 'completed' or 'rejected'
        withdrawal.adminNotes = notes;
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = adminId;

        if (status === 'rejected') {
            // Give money back to user wallet if rejected
            const wallet = await Wallet.findOne({ user: withdrawal.user }).session(session);
            if (wallet) {
                wallet.balance += withdrawal.amount; // amount is the gross amount debited earlier
                await wallet.save({ session });
            }
        }

        await withdrawal.save({ session });

        // Send withdrawal status email (async)
        const EmailService = require('../../common/services/email.service');
        const User = require('mongoose').model('User');
        const user = await User.findById(withdrawal.user).select('name email').lean();
        if (user && user.email) {
            EmailService.sendWithdrawalStatusEmail(user.email, {
                userName: user.name,
                amount: withdrawal.amount,
                status: status,
                processedAt: withdrawal.processedAt,
                notes: notes || (status === 'completed' ? 'Funds have been transferred to your bank account.' : 'Please contact support for more information.')
            }).catch(err => logger.error(`Failed to send withdrawal status email: ${err.message}`));
        }

        // Send App Notification
        await NotificationService.createNotification({
            recipient: withdrawal.user,
            title: status === 'completed' ? 'Withdrawal Successful' : 'Withdrawal Rejected',
            message: status === 'completed'
                ? `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} has been processed.`
                : `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} was rejected. ${notes || ''}`,
            type: 'payment',
            data: { withdrawalId: withdrawal._id, status: status }
        });

        await session.commitTransaction();
        return withdrawal;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};
