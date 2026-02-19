const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
    {
        transactionId: {
            type: String,
            required: true,
            unique: true,
        },
        job: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: false,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            default: 'INR',
        },
        type: {
            type: String,
            enum: ['escrow', 'payout', 'commission', 'refund', 'topup'],
            required: true,
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'refunded'],
            default: 'pending',
        },
        paymentMethod: {
            type: String,
        },
        gatewayResponse: {
            type: Object,
        },
        // Immutable Ledger Hashing
        previousHash: {
            type: String,
            default: '0',
        },
        currentHash: {
            type: String,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

paymentSchema.index({ user: 1 });
paymentSchema.index({ worker: 1 });
paymentSchema.index({ job: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
