const mongoose = require('mongoose');
const Worker = require('./worker.model');
const Badge = require('./badge.model');
const Notification = require('../notifications/notification.model');
const Portfolio = require('./portfolio.model');
const Availability = require('./availability.model');
const EtaTracking = require('./etaTracking.model');
const logger = require('../../config/logger');

/**
 * Internal: Recompute Reliability Score for a worker
 * Factors: Punctuality (ETA), Job Completion, Ratings, and Disputes.
 */
const recomputeReliabilityScore = async (workerId) => {
    try {
        const worker = await Worker.findById(workerId);
        if (!worker) return;

        // 1. Get ETA Analytics
        const etaStats = await EtaTracking.aggregate([
            { $match: { worker: new mongoose.Types.ObjectId(workerId), status: 'arrived' } },
            {
                $group: {
                    _id: null,
                    totalJobs: { $sum: 1 },
                    lateCount: { $sum: { $cond: [{ $eq: ['$isLate', true] }, 1, 0] } },
                    avgDelay: { $avg: '$delayMinutes' }
                }
            }
        ]);

        const stats = etaStats[0] || { totalJobs: 0, lateCount: 0, avgDelay: 0 };

        // Punctuality Score (0-40 points)
        let punctualityPoints = 40;
        if (stats.totalJobs > 0) {
            const lateRate = stats.lateCount / stats.totalJobs;
            punctualityPoints = Math.max(0, 40 - (lateRate * 50)); // Heavy penalty for high late rate
        }

        // 2. Rating Score (0-30 points)
        const ratingPoints = (worker.rating / 5) * 30;

        // 3. Completion & History (0-30 points) - Placeholder for now
        let historyPoints = 20; // Default baseline
        if (worker.reliabilityStats) {
            const cancellationPenalty = (worker.reliabilityStats.cancellations || 0) * 2;
            const disputePenalty = (worker.reliabilityStats.disputes || 0) * 5;
            historyPoints = Math.max(0, 30 - cancellationPenalty - disputePenalty);
        }

        const totalScore = Math.min(100, Math.round(punctualityPoints + ratingPoints + historyPoints));

        worker.reliabilityScore = totalScore;
        // Also update nested stats
        if (worker.reliabilityStats && stats.totalJobs > 0) {
            worker.reliabilityStats.punctuality = Math.round(((stats.totalJobs - stats.lateCount) / stats.totalJobs) * 100);
        }

        await worker.save();
        logger.info(`🔄 Reliability Score for worker ${workerId} updated to ${totalScore}`);

    } catch (error) {
        logger.error(`Recompute Reliability Score Error: ${error.message}`);
    }
};

/**
 * Internal: Check if worker is available at a given date/time
 * Used to prevent job clashes
 */
const isWorkerAvailable = async (workerId, requestedTime, estimatedDurationHours = 2) => {
    try {
        const Job = require('../jobs/job.model');
        const Availability = require('./availability.model');

        const startTime = new Date(requestedTime);
        const endTime = new Date(startTime.getTime() + estimatedDurationHours * 60 * 60 * 1000);

        // 1. Check Schedule (Availability Model)
        const availability = await Availability.findOne({ worker: workerId });
        if (availability) {
            const dayName = startTime.toLocaleDateString('en-US', { weekday: 'short' }); // e.g. "Mon"

            // Check if working on this day
            if (!availability.recurring.days.includes(dayName)) return false;

            // Check overrides
            const override = availability.overrides.find(o =>
                new Date(o.date).toDateString() === startTime.toDateString()
            );
            if (override && !override.isAvailable) return false;

            // Check slots (simplified: check if startTime falls within any slot)
            const timeStr = startTime.toTimeString().slice(0, 5); // "09:00"
            const inSlot = availability.recurring.slots.some(s =>
                timeStr >= s.start && timeStr <= s.end
            );
            if (!inSlot && !override) return false;
        }

        // 2. Check for Overlapping Assigned Jobs
        const overlappingJob = await Job.findOne({
            selected_worker_id: workerId,
            status: { $in: ['assigned', 'in_progress'] },
            $or: [
                {
                    preferred_start_time: {
                        $lt: endTime,
                        $gt: new Date(startTime.getTime() - 2 * 60 * 60 * 1000) // Assumes 2hr block
                    }
                }
            ]
        });

        return !overlappingJob;
    } catch (error) {
        logger.error(`isWorkerAvailable error: ${error.message}`);
        return true; // Default to true on error to avoid blocking? Or false to be safe? 
    }
};

exports.isWorkerAvailable = isWorkerAvailable; // Export for use in other modules


/**
 * Get Worker Portfolio
 */
exports.getPortfolio = async (req, res) => {
    try {
        const { workerId } = req.params;
        const portfolio = await Portfolio.find({ worker: workerId }).sort({ order: 1, createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: portfolio.length,
            data: portfolio
        });
    } catch (error) {
        logger.error(`Get Portfolio Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to fetch portfolio' });
    }
};

/**
 * Add Portfolio Item
 * Max 20 items per worker
 */
exports.addPortfolioItem = async (req, res) => {
    try {
        const { workerId } = req.params; // Or derive from req.user if worker is logged in
        const { title, description, category, beforeImage, afterImage, tags } = req.body;

        const count = await Portfolio.countDocuments({ worker: workerId });
        if (count >= 20) {
            return res.status(400).json({ success: false, message: 'Portfolio limit reached (Max 20 items)' });
        }

        const newItem = await Portfolio.create({
            worker: workerId,
            title,
            description,
            category,
            beforeImage,
            afterImage,
            tags,
        });

        return res.status(201).json({
            success: true,
            message: 'Portfolio item added successfully',
            data: newItem
        });
    } catch (error) {
        logger.error(`Add Portfolio Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to add portfolio item' });
    }
};

/**
 * Delete Portfolio Item
 */
exports.deletePortfolioItem = async (req, res) => {
    try {
        const { id } = req.params;
        // Ideally check ownership logic here (req.user.id === worker.user)

        await Portfolio.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Portfolio item deleted'
        });
    } catch (error) {
        logger.error(`Delete Portfolio Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to delete item' });
    }
};

/**
 * Get Availability
 */
exports.getAvailability = async (req, res) => {
    try {
        const { workerId } = req.params;
        let availability = await Availability.findOne({ worker: workerId });

        if (!availability) {
            // Return default structure if not set
            return res.status(200).json({
                success: true,
                data: {
                    recurring: {
                        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                        slots: [{ start: '09:00', end: '17:00' }]
                    },
                    overrides: []
                }
            });
        }

        return res.status(200).json({ success: true, data: availability });
    } catch (error) {
        logger.error(`Get Availability Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to fetch availability' });
    }
};

/**
 * Update Availability
 */
exports.updateAvailability = async (req, res) => {
    try {
        const { workerId } = req.params;
        const { recurring, overrides, timezone } = req.body;

        let availability = await Availability.findOne({ worker: workerId });

        if (availability) {
            availability.recurring = recurring;
            availability.overrides = overrides;
            availability.timezone = timezone || availability.timezone;
            await availability.save();
        } else {
            availability = await Availability.create({
                worker: workerId,
                recurring,
                overrides,
                timezone
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Availability updated',
            data: availability
        });
    } catch (error) {
        logger.error(`Update Availability Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to update availability' });
    }
};

/**
 * Get ETA Stats
 */
exports.getEtaStats = async (req, res) => {
    try {
        const { workerId } = req.params;

        // Aggregate stats
        const stats = await EtaTracking.aggregate([
            { $match: { worker: new mongoose.Types.ObjectId(workerId), status: { $in: ['arrived', 'completed'] } } },
            {
                $group: {
                    _id: null,
                    avgDelay: { $avg: '$delayMinutes' },
                    totalJobs: { $sum: 1 },
                    lateJobs: {
                        $sum: { $cond: [{ $eq: ['$isLate', true] }, 1, 0] }
                    }
                }
            }
        ]);

        const result = stats[0] || { avgDelay: 0, totalJobs: 0, lateJobs: 0 };
        const accuracy = result.totalJobs > 0
            ? ((result.totalJobs - result.lateJobs) / result.totalJobs) * 100
            : 100;

        return res.status(200).json({
            success: true,
            data: {
                ...result,
                accuracyPercentage: Math.round(accuracy)
            }
        });

    } catch (error) {
        logger.error(`Get ETA Stats Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to fetch ETA stats' });
    }
};

/**
 * Update ETA (Worker "On the way" / "Arrived")
 */
exports.updateEta = async (req, res) => {
    try {
        const { jobId } = req.params;
        const { status, location } = req.body; // status: 'arrived'

        const tracking = await EtaTracking.findOne({ job: jobId });
        if (!tracking) {
            return res.status(404).json({ success: false, message: 'Tracking record not found for this job' });
        }

        tracking.status = status;

        if (status === 'arrived') {
            tracking.actualArrival = new Date();
            const promised = new Date(tracking.promisedArrival);
            const actual = new Date(tracking.actualArrival);

            const diffMs = actual - promised; // milliseconds
            const diffMins = Math.floor(diffMs / 60000);

            tracking.delayMinutes = diffMins > 0 ? diffMins : 0;
            tracking.isLate = diffMins > 15; // 15 min grace period?
        }

        await tracking.save();

        // Trigger Score Recompute
        if (status === 'arrived') {
            await recomputeReliabilityScore(tracking.worker);
        }

        return res.status(200).json({
            success: true,
            message: `Status updated to ${status}`,
            data: tracking
        });

    } catch (error) {
        logger.error(`Update ETA Error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Failed to update ETA' });
    }
};

/**
 * Get Worker Skill Passport
 * Returns public profile + verified skills + badges + warranty stats
 */
exports.getPassport = async (req, res) => {
    try {
        const { id } = req.params;
        const Job = require('../jobs/job.model');
        let worker;

        // Try finding by User ID first, then Worker ID
        worker = await Worker.findOne({ user: id })
            .populate('user', 'name profileImage dateOfBirth address')
            .populate('badges');

        if (!worker) {
            worker = await Worker.findById(id)
                .populate('user', 'name profileImage dateOfBirth address')
                .populate('badges');
        }

        if (!worker) {
            return res.status(404).json({ success: false, message: 'Worker profile not found' });
        }

        // Calculate total jobs completed
        const jobsCompleted = await Job.countDocuments({
            selected_worker_id: worker.user._id,
            status: 'completed'
        });

        // Prepare Passport Data
        const passport = {
            workerId: worker._id,
            userId: worker.user._id,
            name: worker.user.name,
            profileImage: worker.user.profileImage,
            memberSince: worker.createdAt,
            verified: worker.verificationStatus === 'verified',
            rating: worker.rating,
            experienceYears: worker.experience,
            reliabilityScore: worker.reliabilityScore || 50,
            jobsCompleted: jobsCompleted,

            // Skill Identity
            skills: worker.skills,
            skillStats: worker.skill_stats || [],

            // Badges
            badges: worker.badges || [],

            // Warranty / Reliability
            warrantyRecalls: worker.warranty_recalls ? worker.warranty_recalls.length : 0,
            recallHistory: worker.warranty_recalls || []
        };

        res.json({ success: true, data: passport });
    } catch (error) {
        logger.error(`Get Passport Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch skill passport' });
    }
};

/**
 * Check and Apply Skill Decay (Passive AI Logic)
 * Reduces confidence if skill not used in X months
 */
exports.checkSkillDecay = async (req, res) => {
    try {
        const DECAY_THRESHOLD_MONTHS = 3; // Start decaying after 3 months of inactivity
        const DECAY_RATE = 5; // Reduce confidence by 5% per check cycle if inactive

        const workers = await Worker.find({ verificationStatus: 'verified' });
        let decayCount = 0;

        const now = new Date();

        for (const worker of workers) {
            let workerUpdated = false;

            // Initialize skill_stats if missing but skills exist
            if (!worker.skill_stats || worker.skill_stats.length === 0) {
                if (worker.skills && worker.skills.length > 0) {
                    worker.skill_stats = worker.skills.map(skill => ({
                        skill: skill,
                        confidence: 100,
                        last_used: worker.updatedAt // Default to profile update time
                    }));
                    workerUpdated = true;
                }
            }

            // Check each skill
            if (worker.skill_stats) {
                worker.skill_stats.forEach(stat => {
                    const lastUsed = new Date(stat.last_used);
                    const diffMonths = (now - lastUsed) / (1000 * 60 * 60 * 24 * 30);

                    if (diffMonths >= DECAY_THRESHOLD_MONTHS) {
                        // Decay Logic
                        if (stat.confidence > 50) { // Don't decay below 50% automatically
                            stat.confidence = Math.max(50, stat.confidence - DECAY_RATE);
                            workerUpdated = true;
                            decayCount++;

                            // Notify if substantial decay & not already warned
                            if (stat.confidence < 80 && !stat.decay_warning_sent) {
                                // Notify Admin & Worker
                                Notification.create({
                                    recipient: worker.user,
                                    title: 'Skill Decay Alert 📉',
                                    message: `Your confidence in '${stat.skill}' is dropping due to inactivity. Pick up a job to restore it!`,
                                    type: 'system'
                                });
                                stat.decay_warning_sent = true;
                            }
                        }
                    }
                });
            }

            if (workerUpdated) {
                await worker.save();
            }
        }

        res.json({
            success: true,
            message: `Skill decay check completed. Updates processed.`,
            stats: {
                workersChecked: workers.length,
                decayEvents: decayCount
            }
        });

    } catch (error) {
        logger.error(`Skill Decay Check Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get Nearby Workers
 * Query Params: lat, lng, radius (km), skill
 */
exports.getNearbyWorkers = async (req, res) => {
    try {
        const { lat, lng, radius, skill, minPrice, maxPrice, minRating, minWarranty } = req.query;
        const User = require('../users/user.model');
        const logger = require('../../config/logger'); // Ensure logger is available

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
        }

        // Debug Log 1: Incoming Request
        logger.info(`🗺️ Searching Workers: Lat:${lat}, Lng:${lng}, Radius:${radius}km, Skill:${skill}`);

        // 1. Filter Workers by Skill and Attributes
        let workerQuery = {};
        workerQuery.verificationStatus = 'verified';

        if (skill && skill !== 'All') {
            workerQuery.skills = { $in: [skill] };
        }

        // Advanced Filters
        if (minPrice || maxPrice) {
            workerQuery.hourlyRate = {};
            if (minPrice) workerQuery.hourlyRate.$gte = Number(minPrice);
            if (maxPrice) workerQuery.hourlyRate.$lte = Number(maxPrice);
        }

        if (minRating) {
            workerQuery.rating = { $gte: Number(minRating) };
        }

        if (minWarranty) {
            workerQuery.warranty_days = { $gte: Number(minWarranty) };
        }

        const eligibleWorkers = await Worker.find(workerQuery).select('user skills rating hourlyRate reliabilityScore warranty_days'); // Added warranty_days
        const eligibleUserIds = eligibleWorkers.map(w => w.user);

        // Debug Log 2: Eligible Workers found in 'Worker' collection
        logger.info(`Found ${eligibleWorkers.length} eligible workers matching filters.`);

        if (eligibleWorkers.length === 0) {
            return res.json({ success: true, count: 0, data: [], message: 'No workers found with this skill.' });
        }

        // 2. Geo-Spatial Query on Users
        const searchRadiusInfo = radius || 30; // Increased default to 30km per user request

        const nearbyUsers = await User.find({
            _id: { $in: eligibleUserIds },
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [parseFloat(lng), parseFloat(lat)]
                    },
                    $maxDistance: searchRadiusInfo * 1000 // Convert km to meters
                }
            }
        }).select('name profileImage location address');

        // Debug Log 3: Results
        logger.info(`📍 Found ${nearbyUsers.length} users near location.`);

        // 3. Merge Data (User Location + Worker Profile)
        const results = nearbyUsers.map(user => {
            const workerProfile = eligibleWorkers.find(w => w.user.toString() === user._id.toString());
            return {
                id: workerProfile._id,
                userId: user._id,
                name: user.name,
                profileImage: user.profileImage,
                skills: workerProfile.skills,
                rating: workerProfile.rating,
                reliabilityScore: workerProfile.reliabilityScore, // Added
                hourlyRate: workerProfile.hourlyRate,
                location: user.location,
                distance: 0, // Calculated by client or aggregation if needed
            };
        });

        // Optional: Sort by Reliability if requested, otherwise by distance (implicit in $near return order usually, but merging might break it)
        // Since $near returns sorted by distance, nearbyUsers is sorted. 
        // We just mapped it in order, so results should roughly maintain distance order unless specific User/Worker mismatch (which won't happen here).
        // Let's explicitly sort if client wants (e.g. "?sort=rating") but for now this is fine.

        res.json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {
        logger.error(`Get Nearby Workers Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch nearby workers' });
    }
};

/**
 * Subscribe to Premium Plan
 */
exports.subscribe = async (req, res) => {
    try {
        const { plan } = req.body; // 'gold' or 'platinum'
        if (!['gold', 'platinum'].includes(plan)) {
            return res.status(400).json({ success: false, message: 'Invalid plan selected' });
        }

        const worker = await Worker.findOne({ user: req.user._id });
        if (!worker) return res.status(404).json({ message: 'Worker profile not found' });

        // Payment Logic Here (Mock Integration)
        // const amount = plan === 'gold' ? 499 : 999;
        // await PaymentGateway.charge(...)

        // Update Subscription
        worker.subscription = {
            plan: plan,
            expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Days
            autoRenew: true
        };

        await worker.save();

        res.json({
            success: true,
            message: `Successfully subscribed to ${plan} plan! Commision reduced.`,
            data: worker.subscription
        });

    } catch (error) {
        logger.error(`Subscribe Error: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
};
