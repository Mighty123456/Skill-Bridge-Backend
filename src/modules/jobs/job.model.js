const mongoose = require('mongoose');



const jobSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        job_title: {
            type: String,
            required: [true, 'Job title is required'],
            trim: true,
            maxlength: [100, 'Title cannot exceed 100 characters'],
        },
        skill_required: {
            type: String,
            required: [true, 'Skill category is required'],
            trim: true,
            index: true,
        },
        job_description: {
            type: String,
            required: [true, 'Job description is required'],
            trim: true,
            maxlength: [1000, 'Description cannot exceed 1000 characters'],
        },
        issue_photos: [{
            type: String, // URLs
        }],
        location: {
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
            address_text: { type: String, trim: true },
        },
        urgency_level: {
            type: String,
            enum: ['low', 'medium', 'high', 'emergency'],
            default: 'medium',
        },

        quotation_window_hours: {
            type: Number,
            default: 24,
        },
        quotation_start_time: {
            type: Date,
            default: Date.now,
        },
        quotation_end_time: {
            type: Date,
        },
        status: {
            type: String,
            enum: ['open', 'in_progress', 'completed', 'cancelled'],
            default: 'open',
            index: true,
        },
        is_emergency: {
            type: Boolean,
            default: false,
        },
        selected_worker_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User', // Linking to User ID for consistency with Auth
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// Indexes
jobSchema.index({ status: 1, skill_required: 1 });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
