const mongoose = require('mongoose');

/**
 * Contractor model
 * 
 * Stores contractor-specific data.
 * Contractors are similar to workers but may have different fields in the future (e.g. Company Name, License Number).
 * For now, they share similar verification requirements.
 */

const contractorSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
        },

        // Professional Info
        companyName: {
            type: String,
            trim: true
        },
        services: [{
            type: String,
            trim: true,
        }],
        experience: {
            type: Number,
            min: 0,
        },

        // Verification Documents (URLs)
        governmentId: {
            type: String,
        },
        selfie: {
            type: String,
        },
        city: { type: String, trim: true },
        state: { type: String, trim: true },

        // Verification status lifecycle
        verificationStatus: {
            type: String,
            enum: ['pending', 'verified', 'rejected'],
            default: 'pending',
            index: true,
        },

        // Audit trail
        statusHistory: [
            {
                status: {
                    type: String,
                    enum: ['pending', 'verified', 'rejected'],
                    required: true,
                },
                reason: { type: String, trim: true },
                changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
                changedAt: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true,
    },
);

const Contractor = mongoose.model('Contractor', contractorSchema);

module.exports = Contractor;
