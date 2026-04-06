const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema(
    {
        contractor_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        worker_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        project_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: false,  // Optional: contracts can exist without a linked project
            index: true
        },
        title: {
            type: String,
            required: [true, 'Contract title is required'],
            trim: true,
            maxlength: [100, 'Title cannot exceed 100 characters']
        },
        description: {
            type: String,
            trim: true,
            maxlength: [1000, 'Description cannot exceed 1000 characters']
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'active', 'paused', 'completed', 'terminated', 'rejected', 'expired', 'cancelled', 'disputed'],
            default: 'pending',
            index: true
        },
        
        // Agreement Classification
        agreement_type: {
            type: String,
            enum: ['fixed', 'retainer', 'milestone_based', 'hourly'],
            default: 'fixed'
        },
        
        // Financial Terms
        total_value: { 
            type: Number,
            required: function() { return this.agreement_type === 'fixed'; }
        },
        monthly_rate: { 
            type: Number,
            required: function() { return this.agreement_type === 'retainer'; }
        },
        hourly_rate: {
            type: Number,
            required: function() { return this.agreement_type === 'hourly'; }
        },
        max_hours_per_week: {
            type: Number,
            default: 48
        },
        currency: { 
            type: String, 
            default: 'INR' 
        },
        payment_frequency: {
            type: String,
            enum: ['weekly', 'monthly', 'quarterly', 'one-time'],
            default: 'monthly'
        },

        // Duration
        start_date: { 
            type: Date, 
            required: [true, 'Start date is required'] 
        },
        end_date: { 
            type: Date, 
            required: [true, 'End date is required'] 
        },
        actual_end_date: { type: Date },

        // Terms & Renewals
        terms_and_conditions: { 
            type: String,
            required: [true, 'Terms and conditions are required']
        },
        termination_notice_period_days: { 
            type: Number, 
            default: 15 
        },
        auto_renew: { 
            type: Boolean, 
            default: false 
        },
        renewal_count: { 
            type: Number, 
            default: 0 
        },

        // Verification & Signatures
        signed_at: { type: Date },
        contractor_signature: { 
            type: String,
            comment: 'URL to signature image or digital hash'
        },
        worker_signature: { 
            type: String,
            comment: 'URL to signature image or digital hash'
        },

        // Full History Log
        timeline: [
            {
                status: { type: String, required: true },
                timestamp: { type: Date, default: Date.now },
                note: { type: String },
                actor: { 
                    type: String, 
                    enum: ['contractor', 'worker', 'system', 'admin'],
                    required: true
                }
            }
        ],
        
        metadata: {
            type: mongoose.Schema.Types.Mixed
        },

        // Hourly Contract Tracking
        work_sessions: [
            {
                date: { type: Date, required: true },
                start_time: { type: Date, required: true },
                end_time: { type: Date },
                hours: { type: Number, default: 0 },
                status: { type: String, enum: ['active', 'paused', 'completed'], default: 'completed' },
                task_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
                note: { type: String }
            }
        ],

        billing_cycles: [
            {
                start_date: { type: Date, required: true },
                end_date: { type: Date, required: true },
                total_hours: { type: Number, default: 0 },
                gross_amount: { type: Number, default: 0 },
                net_amount: { type: Number, default: 0 },
                platform_fee: { type: Number, default: 0 },
                status: { 
                    type: String, 
                    enum: ['pending_approval', 'approved', 'disputed', 'paid'], 
                    default: 'pending_approval' 
                },
                invoice_id: { type: String },
                escrow_locked: { type: Boolean, default: false },
                paid_at: { type: Date }
            }
        ]
    },
    {
        timestamps: true
    }
);

// Indexes for performance
contractSchema.index({ contractor_id: 1, status: 1 });
contractSchema.index({ worker_id: 1, status: 1 });

const Contract = mongoose.model('Contract', contractSchema);

module.exports = Contract;
