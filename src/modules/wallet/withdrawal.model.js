const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 100, // Minimum withdrawal
        },
        fee: {
            type: Number,
            default: 0,
        },
        tds: {
            type: Number,
            default: 0,
        },
        netAmount: {
            type: Number,
            required: true,
        },
        type: {
            type: String,
            enum: ['instant', 'standard'],
            default: 'standard', // T+1
        },
        payoutMethod: {
            type: String,
            enum: ['stripe', 'manual'],
            default: 'manual', // Manual bank transfer backup
        },
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'processed', 'rejected', 'failed'],
            default: 'pending',
        },
        bankDetails: {
            accountNumber: String,
            ifsc: String,
            bankName: String,
            accountHolderName: String
        },
        processedAt: Date,
        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        adminNotes: String,
        rejectionReason: String,

        // Retry tracking for failed payouts
        retryCount: { type: Number, default: 0 },
        maxRetries: { type: Number, default: 3 },
        lastRetryAt: Date,
        failureReason: String,
        stripeTransferId: String,

        // Guard flag: true once the wallet has been credited back.
        // Prevents CRON 5 from double-crediting a wallet that was already refunded
        // (e.g. on rejection vs. on exhausted retries).
        refunded: { type: Boolean, default: false },
    },
    {
        timestamps: true,
    }
);

// Index for cron jobs to find retryable withdrawals
withdrawalSchema.index({ status: 1, retryCount: 1 });
withdrawalSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
