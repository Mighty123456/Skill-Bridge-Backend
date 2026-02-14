const mongoose = require('mongoose');

const etaTrackingSchema = new mongoose.Schema(
    {
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Worker',
            required: true,
            index: true,
        },
        job: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },

        // Core Data
        status: {
            type: String,
            enum: ['on_the_way', 'arrived', 'delayed', 'cancelled'],
            default: 'on_the_way',
        },

        // Time Points
        promisedArrival: {
            type: Date,
            required: true,
        },
        actualArrival: {
            type: Date,
        },
        delayMinutes: {
            type: Number, // Measured once arrived
            default: 0,
        },

        // Metrics
        isLate: {
            type: Boolean,
            default: false,
        },
        accuracyPercentage: {
            type: Number, // Pre-calculated confidence? Or result? e.g. 100% accurate if within 5 mins
            default: 100,
        },

        // Context
        trafficConditions: { type: String }, // "Heavy", "Normal" (Optional, maybe from external API later)
        distanceKm: { type: Number },

        remarks: { type: String }, // Worker note on delay
    },
    {
        timestamps: true,
    }
);

const EtaTracking = mongoose.model('EtaTracking', etaTrackingSchema);

module.exports = EtaTracking;
