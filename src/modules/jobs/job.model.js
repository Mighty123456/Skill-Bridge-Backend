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
        material_requirements: {
            type: String,
            trim: true,
            maxlength: [500, 'Material requirements cannot exceed 500 characters'],
        },
        issue_photos: [{
            type: String, // URLs
        }],
        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number],
                required: true,
            }, // [longitude, latitude]
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
        preferred_start_time: {
            type: Date,
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
            enum: ['open', 'assigned', 'eta_confirmed', 'on_the_way', 'arrived', 'diagnosis_mode', 'material_pending_approval', 'in_progress', 'reviewing', 'cooling_window', 'completed', 'cancelled', 'disputed'],
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
        completion_photos: [{
            type: String, // URLs for work completion proof
        }],

        // Execution Details
        start_otp: { type: String, select: false }, // Hidden by default
        started_at: { type: Date },
        completed_at: { type: Date },

        // B. ETA & Journey Validation
        journey: {
            confirmed_eta: Date,       // When worker promises to arrive
            started_at: Date,          // When 'Start Journey' clicked
            arrived_at: Date,          // When 'I Have Arrived' clicked
            delays: [{
                reason: String,
                reported_at: Date,
                new_eta: Date
            }],
            worker_location: {
                lat: Number,
                lng: Number
            }
        },

        // C. Diagnosis Mode
        diagnosis_report: {
            materials: [{ name: String, estimated_cost: Number }],
            final_labor_cost: Number,
            final_total_cost: Number,
            photos: [String],
            status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
            submitted_at: Date,
            approved_at: Date,
            rejection_reason: String
        },

        // D. Material Approval Subflow
        material_requests: [{
            item_name: String,
            cost: Number,
            bill_proof: String, // URL
            reason: String,
            status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
            requested_at: { type: Date, default: Date.now },
            responded_at: Date
        }],

        // E. Cooling Window
        cooling_period: {
            starts_at: Date,
            ends_at: Date,
            dispute_raised: { type: Boolean, default: false }
        },

        // Warranty / Recall Tracking
        warranty_claim: {
            active: { type: Boolean, default: false },
            reason: { type: String, trim: true },
            claimed_at: { type: Date },
            resolved: { type: Boolean, default: false },
        },

        // Module 4: Execution & Timeline
        // Security & Constraints
        start_otp_attempts: { type: Number, default: 0 },
        start_otp_lockout_until: { type: Date },

        timeline: [
            {
                status: { type: String, required: true },
                timestamp: { type: Date, default: Date.now },
                actor: { type: String, enum: ['user', 'worker', 'system', 'admin'] },
                note: { type: String }, // Sanitized text
                metadata: { type: mongoose.Schema.Types.Mixed } // For transaction IDs, warnings, lat/lng, etc.
            }
        ],

        dispute: {
            is_disputed: { type: Boolean, default: false },
            reason: { type: String },
            opened_at: { type: Date },
            resolved_at: { type: Date },
            status: { type: String, enum: ['open', 'resolved', 'closed'], default: 'open' }
        },

        payment_released: { type: Boolean, default: false },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// Indexes
jobSchema.index({ location: '2dsphere' });
jobSchema.index({ status: 1, skill_required: 1 });
jobSchema.index({ user_id: 1, status: 1 });
jobSchema.index({ selected_worker_id: 1, status: 1 });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
