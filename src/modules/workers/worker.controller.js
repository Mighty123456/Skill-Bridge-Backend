const Worker = require('./worker.model');
const Badge = require('./badge.model');
const Notification = require('../notifications/notification.model');
const logger = require('../../config/logger');

/**
 * Get Worker Skill Passport
 * Returns public profile + verified skills + badges + warranty stats
 */
exports.getPassport = async (req, res) => {
    try {
        const { id } = req.params;
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

            // Skill Identity
            skills: worker.skills,
            skillStats: worker.skill_stats || [], // Enhanced Stats

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
        const { lat, lng, radius, skill } = req.query;
        const User = require('../users/user.model');

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: 'Latitude and Longitude are required' });
        }

        // 1. Filter Workers by Skill if provided
        let workerQuery = { verificationStatus: 'verified' };
        if (skill && skill !== 'All') {
            workerQuery.skills = { $in: [skill] };
        }

        const eligibleWorkers = await Worker.find(workerQuery).select('user skills rating hourlyRate');
        const eligibleUserIds = eligibleWorkers.map(w => w.user);

        // 2. Geo-Spatial Query on Users
        const searchRadiusInfo = radius || 10; // Default 10km

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
                hourlyRate: workerProfile.hourlyRate,
                location: user.location,
                distance: 0, // Calculated by client or aggregation if needed
            };
        });

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
