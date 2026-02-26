const Rating = require('./rating.model');
const Worker = require('../workers/worker.model');
const Badge = require('../workers/badge.model');
const Job = require('../jobs/job.model');
const logger = require('../../config/logger');

class RatingService {
    /**
     * Submits a rating for a completed job and updates the worker's metrics
     * @param {Object} ratingData Rating data including job, client, worker, and scores
     * @returns {Object} the newly created rating
     */
    async submitRating(ratingData) {
        const { job: jobId, client: clientId, worker: workerId, rating } = ratingData;

        // Verify job completion status (assuming job must be completed or similar state)
        const job = await Job.findById(jobId);
        if (!job) {
            throw new Error('Job not found');
        }

        // Create Rating document
        const newRating = await Rating.create({
            ...ratingData,
            isEmergency: job.is_emergency || false
        });

        // Update Job state
        job.is_rated = true;
        await job.save();

        // Update Worker Statistics & Evaluate Badges
        await this.updateWorkerMetrics(workerId);

        return newRating;
    }

    /**
     * Recalculates worker metrics and evaluates badges based on all their ratings
     * @param {ObjectId} workerId 
     */
    async updateWorkerMetrics(workerId) {
        const worker = await Worker.findById(workerId).populate('badges');
        if (!worker) {
            throw new Error('Worker not found');
        }

        // 1. Calculate Average Rating and Job Count
        const ratings = await Rating.find({ worker: workerId });
        const totalJobsCompleted = ratings.length;

        let avgRating = 5.0;
        if (totalJobsCompleted > 0) {
            const sum = ratings.reduce((acc, curr) => acc + curr.rating, 0);
            avgRating = parseFloat((sum / totalJobsCompleted).toFixed(2));
        }

        // 2. Calculate Reliability Score (simplified logic based on punctuality and general performance)
        let reliabilityScore = worker.reliabilityScore;
        if (totalJobsCompleted > 0) {
            const punctualitySum = ratings.reduce((acc, curr) => acc + curr.punctualityScore, 0);
            const avgPunctuality = punctualitySum / totalJobsCompleted; // out of 5

            // Base score on a mix of avg rating and punctuality
            reliabilityScore = ((avgRating / 5) * 50) + ((avgPunctuality / 5) * 50);
        }

        // Penalize score for disputes or cancellations (assuming those exist on the worker document)
        const cancellations = worker.reliabilityStats?.cancellations || 0;
        const disputes = worker.reliabilityStats?.disputes || 0;
        reliabilityScore = Math.max(0, reliabilityScore - (cancellations * 5) - (disputes * 10));

        // 3. Evaluate Badges
        const emergencyRatings = ratings.filter(r => r.isEmergency);
        const emergencyCount = emergencyRatings.length;
        const emergencyPunctualitySum = emergencyRatings.reduce((acc, curr) => acc + curr.punctualityScore, 0);
        const avgEmergencyPunctuality = emergencyCount > 0 ? (emergencyPunctualitySum / emergencyCount) : 0;

        // Get all system badges
        const allBadges = await Badge.find({ isActive: true });

        // Logic for assigning badges
        const earnedBadgeIds = [];

        allBadges.forEach(badge => {
            let earned = false;
            const slug = badge.slug.toLowerCase();

            switch (slug) {
                case 'rising-star':
                    earned = totalJobsCompleted >= 5 && avgRating >= 4.5;
                    break;
                case 'proven-pro':
                    earned = totalJobsCompleted >= 25 && avgRating >= 4.6;
                    break;
                case 'elite-pro':
                case 'master-craftsman':
                    earned = totalJobsCompleted >= 100 && avgRating >= 4.8;
                    break;
                case 'swift-savior':
                case 'first-responder':
                    earned = emergencyCount >= 5 && avgEmergencyPunctuality >= 4.5; // High punctuality on emg jobs
                    break;
                case 'trusted-partner':
                    earned = reliabilityScore >= 90 && disputes === 0 && cancellations === 0;
                    break;
            }

            if (earned) {
                earnedBadgeIds.push(badge._id);
            }
        });

        // Handle revocations implicitly: If they no longer meet previous badge criteria, it will just not be included in earnedBadgeIds.
        // Except for maybe foundational badges like KYC which are not dynamically based on ratings. 
        // Usually, we only want to auto-manage performance-based badges here.

        // Keep non-performance badges (kyc, background-check, etc.)
        const currentBadges = worker.badges || [];
        const manualBadgeSlugs = ['kyc-verified', 'background-checked'];
        const keptBadgeIds = currentBadges
            .filter(b => manualBadgeSlugs.includes(b.slug))
            .map(b => b._id);

        // Combine kept manual badges + newly earned performance badges (unique array)
        const combinedBadgeIds = [...new Set([...keptBadgeIds, ...earnedBadgeIds])];

        worker.rating = avgRating;
        worker.totalJobsCompleted = totalJobsCompleted;
        worker.reliabilityScore = reliabilityScore;
        worker.badges = combinedBadgeIds;

        await worker.save();

        logger.info(`Worker ${workerId} metrics updated: Rating=${avgRating}, Jobs=${totalJobsCompleted}, Score=${reliabilityScore}`);
    }

    /**
     * Get ratings for a specific worker
     */
    async getWorkerRatings(workerId, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const ratings = await Rating.find({ worker: workerId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('client', 'firstName lastName profilePicture');

        const total = await Rating.countDocuments({ worker: workerId });

        return {
            ratings,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        };
    }
}

module.exports = new RatingService();
