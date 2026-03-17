const mongoose = require('mongoose');

const hiringRequestSchema = new mongoose.Schema({
    contractor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    worker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    proposedRate: {
        type: Number,
        required: true
    },
    message: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
    },
    respondedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for quick lookups
hiringRequestSchema.index({ contractor: 1 });
hiringRequestSchema.index({ worker: 1, status: 1 });
hiringRequestSchema.index({ project: 1 });

const HiringRequest = mongoose.model('HiringRequest', hiringRequestSchema);

module.exports = HiringRequest;
