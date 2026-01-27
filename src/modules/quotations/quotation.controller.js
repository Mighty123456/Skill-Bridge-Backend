const Quotation = require('./quotation.model');
const Job = require('../jobs/job.model');
const Notification = require('../notifications/notification.model');
const emailService = require('../../common/services/email.service');

// Create a new quotation
exports.createQuotation = async (req, res) => {
    try {
        const { job_id, labor_cost, material_cost, estimated_days, notes, tags } = req.body;
        const worker_id = req.user._id;

        // 1. Validate Job
        const job = await Job.findById(job_id);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (job.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Job is not open for quotations' });
        }

        // 2. Validate Time Phase (optional check if end_time exists)
        const now = new Date();
        if (job.quotation_end_time && now > job.quotation_end_time) {
            return res.status(400).json({ success: false, message: 'Quotation submission window has closed' });
        }

        // 3. Check for Duplicate
        const existingQuotation = await Quotation.findOne({ job_id, worker_id });
        if (existingQuotation) {
            return res.status(409).json({ success: false, message: 'You have already submitted a quotation for this job' });
        }

        // 4. Handle Video Upload (if any)
        let video_url = null;
        if (req.files && req.files.video_pitch && req.files.video_pitch.length > 0) {
            const videoFile = req.files.video_pitch[0];
            const cloudinaryService = require('../../common/services/cloudinary.service');
            // uploadImage handles Buffer from memory storage
            const result = await cloudinaryService.uploadImage(videoFile.buffer, 'quotations');
            if (result && result.url) {
                video_url = result.url;
            }
        }

        // 5. Create Quotation
        // Ensure inputs are numbers
        const l_cost = Number(labor_cost);
        const m_cost = Number(material_cost || 0);
        const total_cost = l_cost + m_cost;

        const quotation = new Quotation({
            job_id,
            worker_id,
            labor_cost: l_cost,
            material_cost: m_cost,
            total_cost,
            estimated_days: Number(estimated_days),
            notes,
            tags: tags ? (typeof tags === 'string' ? JSON.parse(tags) : tags) : [], // Handle potential stringification in multipart
            video_url
        });

        await quotation.save();

        // 6. Notify Tenant
        await Notification.create({
            recipient: job.user_id,
            title: 'New Quotation Received',
            message: `You have received a new quotation for your job: ${job.job_title}`,
            type: 'quotation_received',
            data: { jobId: job._id, quotationId: quotation._id }
        });

        res.status(201).json({ success: true, data: quotation });

    } catch (error) {
        console.error('Create Quotation Error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit quotation', error: error.message });
    }
};

// Get quotations for a job
exports.getQuotationsByJob = async (req, res) => {
    try {
        const { jobId } = req.params;

        const job = await Job.findById(jobId);
        if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

        // Authorization: Only Job Owner (Tenant) can see all quotations
        if (job.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to view quotations for this job' });
        }

        const quotations = await Quotation.find({ job_id: jobId })
            .populate('worker_id', 'name phone profileImage')
            .sort({ total_cost: 1 }); // Sort by lowest cost

        res.json({ success: true, data: quotations });

    } catch (error) {
        console.error('Get Quotations Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch quotations' });
    }
};

// Accept a quotation
exports.acceptQuotation = async (req, res) => {
    try {
        const { id } = req.params; // Quotation ID

        const quotation = await Quotation.findById(id).populate('job_id').populate('worker_id', 'name email');
        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        const job = quotation.job_id;
        const worker = quotation.worker_id;

        // Authorization
        if (job.user_id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to accept quotations for this job' });
        }

        if (job.status !== 'open') {
            return res.status(400).json({ success: false, message: 'Job is not open' });
        }

        // Update Job
        job.status = 'assigned'; // Phase 4 Change: Set to 'assigned', waiting for OTP start
        job.selected_worker_id = worker._id;

        // Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        job.start_otp = otp;

        await job.save();

        // Update Quotation Status
        quotation.status = 'accepted';
        await quotation.save();

        // Reject other quotations for this job
        await Quotation.updateMany(
            { job_id: job._id, _id: { $ne: quotation._id } },
            { $set: { status: 'rejected' } }
        );

        // Notify Worker (In-App)
        await Notification.create({
            recipient: worker._id,
            title: 'Quotation Accepted!',
            message: `Your quotation for ${job.job_title} has been accepted. You can now start the work.`,
            type: 'quotation_accepted',
            data: { jobId: job._id }
        });

        // Notify Worker (Email)
        if (worker.email) {
            await emailService.sendQuotationAcceptedEmail(
                worker.email,
                worker.name,
                job.job_title,
                quotation.total_cost
            );
        }

        res.json({ success: true, message: 'Quotation accepted', data: job });

    } catch (error) {
        console.error('Accept Quotation Error:', error);
        res.status(500).json({ success: false, message: 'Failed to accept quotation' });
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
