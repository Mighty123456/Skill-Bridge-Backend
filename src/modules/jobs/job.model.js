const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: [true, 'Job title is required'],
            trim: true,
            maxlength: [100, 'Title cannot exceed 100 characters'],
        },
        description: {
            type: String,
            required: [true, 'Job description is required'],
            trim: true,
            maxlength: [1000, 'Description cannot exceed 1000 characters'],
        },
        skill: {
            type: String,
            required: [true, 'Skill category is required'],
            trim: true,
            index: true,
        },
        images: [{
            type: String, // URLs
        }],
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: [true, 'Job location is required'],
                index: '2dsphere',
            },
            address: {
                type: String,
                trim: true,
            },
        },
        budget: {
            min: { type: Number, min: 0 },
            max: { type: Number, min: 0 },
        },
        urgency: {
            type: String,
            enum: ['low', 'medium', 'high', 'emergency'],
            default: 'medium',
        },
        quotationWindow: {
            type: Date,
            // Default 24 hours from now
            default: () => new Date(+new Date() + 24 * 60 * 60 * 1000),
        },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'completed', 'cancelled'],
            default: 'open',
            index: true,
        },
        postedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User', // Worker's User ID
        },
    },
    {
        timestamps: true,
    }
);

// Indexes
jobSchema.index({ status: 1, skill: 1 });
jobSchema.index({ location: '2dsphere' });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
