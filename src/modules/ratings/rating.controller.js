const ratingService = require('./rating.service');
const logger = require('../../config/logger');

/**
 * Controller for handling rating and feedback requests
 */
exports.submitRating = async (req, res) => {
    try {
        const { job: jobId, worker: workerId, rating, punctualityScore, communicationScore, workQualityScore, comment } = req.body;
        const clientId = req.user._id;

        if (!jobId || !workerId || !rating) {
            return res.status(400).json({ success: false, message: 'Job, Worker, and Rating are required' });
        }

        // Basic validation that values are within 1-5 range
        const isValidScore = (score) => !score || (score >= 1 && score <= 5);

        if (!isValidScore(rating) || !isValidScore(punctualityScore) || !isValidScore(communicationScore) || !isValidScore(workQualityScore)) {
            return res.status(400).json({ success: false, message: 'Scores must be between 1 and 5' });
        }

        const ratingData = {
            job: jobId,
            client: clientId,
            worker: workerId,
            rating,
            punctualityScore: punctualityScore || 5, // Defaulting if not provided
            communicationScore: communicationScore || 5,
            workQualityScore: workQualityScore || 5,
            comment
        };

        const newRating = await ratingService.submitRating(ratingData);

        res.status(201).json({
            success: true,
            data: newRating,
            message: 'Thank you! Rating submitted successfully.',
        });
    } catch (error) {
        logger.error('Submit Rating Error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'You have already submitted a rating for this job.' });
        }
        res.status(500).json({ success: false, message: error.message || 'Failed to submit rating' });
    }
};

exports.getWorkerRatings = async (req, res) => {
    try {
        const { workerId } = req.params;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;

        if (!workerId) {
            return res.status(400).json({ success: false, message: 'Worker ID is required' });
        }

        const result = await ratingService.getWorkerRatings(workerId, page, limit);

        res.status(200).json({
            success: true,
            data: result.ratings,
            pagination: result.pagination,
        });
    } catch (error) {
        logger.error('Get Worker Ratings Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch worker ratings' });
    }
};
