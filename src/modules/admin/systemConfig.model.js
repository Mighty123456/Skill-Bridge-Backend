const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema(
    {
        commissionRate: {
            type: Number,
            required: true,
            default: 12, // 12% default
        },
        emergencySurcharge: {
            type: Number,
            required: true,
            default: 25, // 25% extra for emergency
        },
        minRatingForWorkerBadge: {
            type: Number,
            required: true,
            default: 4.5,
        },
        quotationWindow: {
            type: Number,
            required: true,
            default: 24,
        },
        searchRadius: {
            type: Number,
            required: true,
            default: 15,
        },
        badgeMinJobs: {
            type: Number,
            required: true,
            default: 10,
        },
        systemStatus: {
            type: String,
            enum: ['online', 'maintenance', 'offline'],
            default: 'online',
        },
        lastChangedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
        },
    },
    {
        timestamps: true,
    }
);

const SystemConfig = mongoose.model('SystemConfig', systemConfigSchema);

module.exports = SystemConfig;
