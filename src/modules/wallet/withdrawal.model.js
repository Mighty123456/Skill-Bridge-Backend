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
        netAmount: {
            type: Number,
            required: true,
        },
        type: {
            type: String,
            enum: ['instant', 'standard'],
            default: 'standard', // T+1
        },
        status: {
            type: String,
            enum: ['pending', 'processed', 'rejected'],
            default: 'pending',
        },
        bankDetails: {
            accountNumber: String,
            ifsc: String,
            bankName: String,
            accountHolderName: String
        },
        processedAt: Date,
        rejectionReason: String
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
