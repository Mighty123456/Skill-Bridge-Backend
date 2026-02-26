const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema(
    {
        job: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            unique: true, // One rating per job
        },
        client: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Worker',
            required: true,
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        punctualityScore: {
            type: Number,
            min: 1,
            max: 5,
            default: 5,
        },
        communicationScore: {
            type: Number,
            min: 1,
            max: 5,
            default: 5,
        },
        workQualityScore: {
            type: Number,
            min: 1,
            max: 5,
            default: 5,
        },
        comment: {
            type: String,
            trim: true,
            maxlength: 1000,
        },
        isEmergency: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for faster querying
ratingSchema.index({ worker: 1, createdAt: -1 });
ratingSchema.index({ client: 1, createdAt: -1 });

const Rating = mongoose.model('Rating', ratingSchema);

module.exports = Rating;
