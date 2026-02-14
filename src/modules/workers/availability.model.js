const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema(
    {
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Worker',
            required: true,
            unique: true, // One schedule per worker
        },

        // Core working hours per week (Recurring)
        recurring: {
            days: { // ['mon', 'tue', ...]
                type: [String],
                enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            },
            slots: [{
                start: { type: String, required: true }, // "09:00"
                end: { type: String, required: true }, // "17:00"
            }],
        },

        // One-off overrides (e.g. Vacation, Public Holiday)
        overrides: [{
            date: { type: Date, required: true }, // Specific Day
            isAvailable: { type: Boolean, default: false }, // If false, blocked.
            reason: String,
            slots: [{ // If true, custom slots for that day
                start: String,
                end: String,
            }],
        }],

        timezone: {
            type: String,
            default: 'Asia/Kolkata',
        },

        bookingBufferMinutes: {
            type: Number,
            default: 30, // Time between jobs
        },
    },
    {
        timestamps: true,
    }
);

// We might need methods to check overlap

const Availability = mongoose.model('Availability', availabilitySchema);

module.exports = Availability;
