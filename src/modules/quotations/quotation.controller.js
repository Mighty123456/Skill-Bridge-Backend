const Quotation = require('./quotation.model');
const Job = require('../jobs/job.model');
const Notification = require('../notifications/notification.model');
const emailService = require('../../common/services/email.service');

// Create a new quotation
exports.createQuotation = async (req, res) => {
    try {
        const { job_id, labor_cost, material_cost, estimated_days, notes } = req.body;
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

        // 4. Create Quotation
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
            notes
        });

        await quotation.save();

        // 5. Notify Tenant
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
        job.status = 'in_progress';
        job.selected_worker_id = worker._id;
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
