const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema(
    {
        job_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        worker_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User', // Assuming Worker is a User with role 'worker'
            required: true,
        },
        labor_cost: {
            type: Number,
            required: [true, 'Labor cost is required'],
            min: [0, 'Labor cost cannot be negative'],
        },
        material_cost: {
            type: Number,
            default: 0,
            min: [0, 'Material cost cannot be negative'],
        },
        total_cost: {
            type: Number,
            required: true,
        },
        estimated_days: {
            type: Number,
            required: [true, 'Estimated timeline (days) is required'],
            min: [1, 'At least 1 day is required'],
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Notes cannot exceed 500 characters'],
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending',
            index: true,
        },
        tags: [{ type: String, trim: true }], // Price justification tags
        video_url: { // Video pitch URL
            type: String,
            trim: true,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// Prevent duplicate quotations from same worker for same job
quotationSchema.index({ job_id: 1, worker_id: 1 }, { unique: true });

const Quotation = mongoose.model('Quotation', quotationSchema);

module.exports = Quotation;
