const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema(
    {
        worker: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Worker', // Or Contractor, logic handles relationship
            required: true,
            index: true,
        },
        // Allows referencing Contractor if needed, though usually 'Worker' model covers both in some architectures.
        // Given current separation, we might need a dynamic ref or just store ID.
        // For now, let's assume it links to the 'Worker' or 'Contractor' profile ID.

        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 500,
        },
        category: {
            type: String, // e.g., "Plumbing", "Electrical", "Renovation"
            trim: true,
            index: true,
        },

        // Images
        beforeImage: {
            type: String, // URL
        },
        afterImage: {
            type: String, // URL
            required: true,
        },

        // Metadata
        completionDate: {
            type: Date,
        },
        location: {
            type: String, // e.g., "Mumbai, Andheri"
        },
        tags: [{
            type: String,
            trim: true,
        }],

        // Ordering
        order: {
            type: Number,
            default: 0,
        }
    },
    {
        timestamps: true,
        collection: 'worker_portfolio'
    }
);

// Limit check is usually done in controller/service (Max 20)

const Portfolio = mongoose.model('Portfolio', portfolioSchema);

module.exports = Portfolio;
