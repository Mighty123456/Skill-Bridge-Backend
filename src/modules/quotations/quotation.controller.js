const Quotation = require('./quotation.model');
const Job = require('../jobs/job.model');
const Notification = require('../notifications/notification.model');
const emailService = require('../../common/services/email.service');

const QuotationService = require('./quotation.service');
const logger = require('../../config/logger');


// Create a new quotation
// Create a new quotation
exports.createQuotation = async (req, res) => {
    try {
        const { job_id, labor_cost, material_cost, estimated_days, notes, tags } = req.body;

        let parsedTags = [];
        try {
            parsedTags = tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [];
        } catch (e) {
            logger.warn('Failed to parse tags JSON');
        }

        const quotationData = {
            job_id,
            labor_cost,
            material_cost,
            estimated_days,
            notes,
            tags: parsedTags
        };

        const videoFile = (req.files && req.files.video_pitch && req.files.video_pitch[0]) ? req.files.video_pitch[0] : null;

        const result = await QuotationService.createQuotation(quotationData, req.user, videoFile);

        res.status(201).json({
            success: true,
            data: result.quotation,
            warning: result.warning
        });

    } catch (error) {
        if (error.code === 'WORKER_NOT_VERIFIED') {
            return res.status(403).json({ success: false, message: error.message, errorCode: error.code });
        }
        logger.error('Create Quotation Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to submit quotation' });
    }
};

// Get quotations for a job
exports.getQuotationsByJob = async (req, res) => {
    try {
        const { jobId } = req.params;
        const quotations = await QuotationService.getQuotationsForJob(jobId, req.user._id);
        res.json({ success: true, data: quotations });
    } catch (error) {
        logger.error('Get Quotations Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch quotations' });
    }
};

// Accept a quotation
exports.acceptQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await QuotationService.acceptQuotation(id, req.user._id);
        res.json({ success: true, message: 'Quotation accepted', data: job });
    } catch (error) {
        logger.error('Accept Quotation Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to accept quotation' });
    }
};

// Price Stats (Statistical AI)
exports.getQuotationStats = async (req, res) => {
    try {
        const { skill } = req.query;
        if (!skill) return res.status(400).json({ success: false, message: 'Skill is required' });

        // Aggregate stats from approved/accepted quotations in that category
        // In a real generic app we might aggregate by skill.
        // For now, we will aggregate all quotations for jobs that required this skill.

        const stats = await Quotation.aggregate([
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'job_id',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            {
                $unwind: '$job'
            },
            {
                $match: {
                    'job.skill_required': skill,
                    // Optionally calculate only accepted ones for "market rate", 
                    // but for more data points we can use all non-rejected or all.
                    // 'status': 'accepted' 
                }
            },
            {
                $group: {
                    _id: null,
                    avgCost: { $avg: '$total_cost' },
                    minCost: { $min: '$total_cost' },
                    maxCost: { $max: '$total_cost' },
                    count: { $sum: 1 }
                }
            }
        ]);

        if (stats.length === 0) {
            return res.json({ success: true, data: { avgCost: 0, count: 0 } });
        }

        res.json({ success: true, data: stats[0] });

    } catch (error) {
        console.error('Get Stats Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
};
