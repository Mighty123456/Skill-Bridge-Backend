const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            trim: true,
        },
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
        },
        targetId: {
            type: String, // String to handle different target IDs
            required: true,
        },
        targetType: {
            type: String, // e.g., 'user', 'worker', 'job', 'rating', 'system'
            required: true,
        },
        description: {
            type: String,
            required: true,
            trim: true,
        },
        ipAddress: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
);

systemLogSchema.index({ adminId: 1, createdAt: -1 });
systemLogSchema.index({ targetType: 1, createdAt: -1 });

const SystemLog = mongoose.model('SystemLog', systemLogSchema);

module.exports = SystemLog;
