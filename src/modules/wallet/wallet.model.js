const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: function () { return this.type === 'user'; },
            unique: true,
            sparse: true // Allow multiple nulls for platform wallets if needed, though usually there is only one
        },
        type: {
            type: String,
            enum: ['user', 'platform'],
            default: 'user'
        },
        balance: {
            type: Number,
            default: 0,
            min: 0,
        },
        escrowBalance: {
            type: Number,
            default: 0,
            min: 0,
        },
        pendingBalance: {
            type: Number,
            default: 0,
            min: 0,
        },
        warrantyReserveBalance: {
            type: Number,
            default: 0,
            min: 0,
        },
        activeWarranties: [
            {
                amount: Number,
                releaseAt: Date,
                jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' }
            }
        ],
        pendingPayouts: [
            {
                amount: Number,
                releaseAt: Date,
                jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' }
            }
        ],
        currency: {
            type: String,
            default: 'INR',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
