const Wallet = require('./wallet.model');
const mongoose = require('mongoose');
const Withdrawal = require('./withdrawal.model');
const NotificationService = require('../notifications/notification.service');
const notifyHelper = require('../../common/notification.helper');
const logger = require('../../config/logger');
const SystemConfig = require('../admin/systemConfig.model');

/**
 * Get or create wallet for a user
 */
exports.getWallet = async (userId) => {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
        wallet = await Wallet.create({ user: userId });
    } else {
        // Auto-check for released funds
        await exports.checkAndReleasePending(userId);
        wallet = await Wallet.findOne({ user: userId }); // Reload
    }
    return wallet;
};

/**
 * Check and Release Pending Funds
 */
exports.checkAndReleasePending = async (userId) => {
    const wallet = await Wallet.findOne({ user: userId });
    if (!wallet) return;

    let modified = false;
    const now = new Date();

    // 1. Process Pending Payouts (Normal Jobs)
    if (wallet.pendingPayouts && wallet.pendingPayouts.length > 0) {
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
            modified = true;
            notifyHelper.onWalletTransaction(
                userId,
                'Funds Available!',
                `₹${releasedAmount.toFixed(2)} has been released and is now available in your balance.`,
                { type: 'payout_released' }
            ).catch(err => logger.error(`Failed to send payout release notification: ${err.message}`));
            logger.info(`Released ₹${releasedAmount} pending funds for user ${userId}`);
        }
    }

    // 2. Process Warranty Reserves (Expire & Release)
    if (wallet.activeWarranties && wallet.activeWarranties.length > 0) {
        let releasedWarranty = 0;
        const remainingWarranties = [];

        for (const w of wallet.activeWarranties) {
            if (w.releaseAt <= now) {
                releasedWarranty += w.amount;
            } else {
                remainingWarranties.push(w);
            }
        }

        if (releasedWarranty > 0) {
            wallet.balance += releasedWarranty;
            wallet.warrantyReserveBalance = Math.max(0, wallet.warrantyReserveBalance - releasedWarranty);
            wallet.activeWarranties = remainingWarranties;
            modified = true;
            notifyHelper.onWalletTransaction(
                userId,
                'Warranty Expired. Funds Released!',
                `₹${releasedWarranty.toFixed(2)} from your warranty reserve has been released.`,
                { type: 'warranty_released' }
            ).catch(err => logger.error(`Failed to send warranty release notice: ${err.message}`));
            logger.info(`Released ₹${releasedWarranty} warranty reserve for user ${userId}`);
        }
    }

    if (modified) {
        await wallet.save();
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
    await notifyHelper.onWalletTransaction(
        userId,
        'Wallet Topped Up!',
        `₹${amount.toFixed(2)} has been added to your wallet.`,
        { type: 'topup_success', amount }
    ).catch(err => logger.error(`Failed to send topup notification: ${err.message}`));

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
exports.requestWithdrawal = async (userId, amount, type = 'standard', payoutMethod = 'manual', bankDetails) => {
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

        // Fetch Dynamic Configuration for TDS
        const sysConfig = await SystemConfig.findOne().sort({ createdAt: -1 });
        const TDS_RATE = sysConfig ? (sysConfig.tdsRate / 100) : 0.01;

        const tds = Math.round(amount * TDS_RATE); // Statutory TDS
        const netAmount = amount - fee - tds;

        if (netAmount <= 0) throw new Error('Amount too low to cover fees and TDS');

        // Debit Wallet
        wallet.balance -= amount;
        await wallet.save({ session });

        // Create Withdrawal Record
        const withdrawal = new Withdrawal({
            user: userId,
            amount,
            fee,
            tds,
            netAmount,
            type,
            payoutMethod,
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
        await notifyHelper.onWithdrawalStatus(
            userId,
            'Withdrawal Requested',
            `Your request for ₹${amount.toFixed(2)} has been received.`,
            { withdrawalId: withdrawal._id, status: 'pending' }
        );

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

        if (status === 'completed') {
            if (withdrawal.payoutMethod === 'stripe') {
                // Trigger actual transfer via Stripe Connect if onboarded
                try {
                    const PaymentService = require('../payments/payment.service');
                    const stripeResult = await PaymentService.processStripeTransfer(withdrawal.user, withdrawal.netAmount, `WITHDRAWAL_${withdrawal._id}`);
                    
                    if (stripeResult.success) {
                        withdrawal.status = 'completed'; // Ensure status is correctly set
                        withdrawal.adminNotes = (notes || '') + ` (Stripe Transfer: ${stripeResult.transferId})`;
                        withdrawal.stripeTransferId = stripeResult.transferId;
                    } else {
                        withdrawal.status = 'failed';
                        withdrawal.failureReason = stripeResult.message;
                        withdrawal.adminNotes = (notes || '') + ` (Stripe transfer failed: ${stripeResult.message}. Amount refunded to wallet.)`;
                        
                        // Give money back to user wallet if failed
                        const wallet = await Wallet.findOne({ user: withdrawal.user }).session(session);
                        if (wallet) {
                            wallet.balance += withdrawal.amount;
                            await wallet.save({ session });
                        }
                        logger.warn(`Stripe auto-payout failed for withdrawal ${withdrawalId}: ${stripeResult.message}. Refunded.`);
                    }
                } catch (err) {
                    withdrawal.status = 'failed';
                    withdrawal.failureReason = err.message;
                    withdrawal.adminNotes = (notes || '') + ` (Stripe error: ${err.message}. Amount refunded to wallet.)`;
                    
                    // Give money back to user wallet if failed
                    const wallet = await Wallet.findOne({ user: withdrawal.user }).session(session);
                    if (wallet) {
                        wallet.balance += withdrawal.amount;
                        await wallet.save({ session });
                    }
                    logger.error(`Withdrawal Stripe integration error: ${err.message}. Refunded.`);
                }
            } else {
                // Manual Payout Mode
                withdrawal.status = 'completed';
                withdrawal.adminNotes = (notes || '') + ' (Processed via Manual Bank Transfer)';
                logger.info(`Withdrawal ${withdrawalId} completed manually by admin`);
            }
        }

        if (status === 'rejected') {
            // Give money back to user wallet if rejected
            const wallet = await Wallet.findOne({ user: withdrawal.user }).session(session);
            if (wallet) {
                wallet.balance += withdrawal.amount; // amount is the gross amount debited earlier
                await wallet.save({ session });
            }
        }

        await withdrawal.save({ session });

        // Setup final notification status and strings based on actual withdrawal outcome
        const finalStatus = withdrawal.status; // 'completed', 'rejected', or 'failed'
        let notificationTitle = 'Withdrawal Processed';
        let notificationBody = `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} has been processed.`;
        let emailNotes = notes || 'Funds have been transferred to your bank account.';

        if (finalStatus === 'rejected') {
            notificationTitle = 'Withdrawal Rejected';
            notificationBody = `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} was rejected. ${notes || ''}`;
            emailNotes = notes || 'Please contact support for more information.';
        } else if (finalStatus === 'failed') {
            notificationTitle = 'Withdrawal Failed';
            notificationBody = `Your withdrawal of ₹${withdrawal.amount.toFixed(2)} failed due to a bank/network issue. The amount has been refunded to your wallet.`;
            emailNotes = 'Your withdrawal failed and the amount has been refunded to your wallet. Please check your bank details and try again.';
        } else {
             notificationTitle = 'Withdrawal Successful';
        }

        // Send withdrawal status email (async)
        const EmailService = require('../../common/services/email.service');
        const User = require('mongoose').model('User');
        const user = await User.findById(withdrawal.user).select('name email').lean();
        if (user && user.email) {
            EmailService.sendWithdrawalStatusEmail(user.email, {
                userName: user.name,
                amount: withdrawal.amount,
                status: finalStatus,
                processedAt: withdrawal.processedAt,
                notes: emailNotes
            }).catch(err => logger.error(`Failed to send withdrawal status email: ${err.message}`));
        }

        // Send App Notification
        await notifyHelper.onWithdrawalStatus(
            withdrawal.user,
            notificationTitle,
            notificationBody,
            { withdrawalId: withdrawal._id, status: finalStatus }
        );

        await session.commitTransaction();
        return withdrawal;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Get daily earnings stats for a worker (last 7 days)
 */
exports.getEarningsStats = async (workerId) => {
    const Payment = require('../payments/payment.model');
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const stats = await Payment.aggregate([
        {
            $match: {
                worker: new mongoose.Types.ObjectId(workerId),
                type: 'payout',
                status: 'completed',
                createdAt: { $gte: sevenDaysAgo }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                totalAmount: { $sum: "$amount" }
            }
        },
        { $sort: { "_id": 1 } }
    ]);

    // Fill missing days with 0
    const result = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(sevenDaysAgo);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayStat = stats.find(s => s._id === dateStr);
        result.push({
            date: dateStr,
            amount: dayStat ? dayStat.totalAmount : 0
        });
    }

    return result;
};

/**
 * Lock funds in escrow for a project
 */
exports.lockEscrow = async (userId, projectId, workerId, amount, description) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const wallet = await Wallet.findOne({ user: userId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        if (wallet.balance < amount) {
            throw new Error(`Insufficient funds. Available: ₹${wallet.balance}`);
        }

        // 1. Debit User Balance and Increase Escrow Balance
        wallet.balance -= amount;
        wallet.escrowBalance += amount;
        await wallet.save({ session });

        // 2. Create Escrow Payment Record
        const Payment = require('../payments/payment.model');
        const crypto = require('crypto');
        
        const escrowPayment = new Payment({
            transactionId: `ESCROW_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            job: projectId,
            user: userId,
            worker: workerId,
            amount: amount,
            type: 'escrow',
            status: 'completed', // Status is 'completed' because funds are successfully moved to platform hold
            paymentMethod: 'wallet',
            gatewayResponse: {
                description: description || `Escrow for project ${projectId}`,
                lockedAt: new Date()
            }
        });

        await escrowPayment.save({ session });

        // 3. Notify Worker
        const notifyHelper = require('../../common/notification.helper');
        await notifyHelper.onWalletTransaction(
            workerId,
            'Project Funds Secured',
            `A contractor has locked ₹${amount} in escrow for your project. Complete the work to receive payment.`,
            { type: 'escrow_locked', projectId, amount }
        ).catch(err => logger.error(`Failed to notify worker of escrow: ${err.message}`));

        await session.commitTransaction();
        return escrowPayment;

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

/**
 * Get all escrow records for a project
 */
exports.getProjectEscrows = async (projectId) => {
    const Payment = require('../payments/payment.model');
    return await Payment.find({ 
        job: projectId, 
        type: 'escrow' 
    }).populate('worker', 'name profileImage').sort({ createdAt: -1 });
};
