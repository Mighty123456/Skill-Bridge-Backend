const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');
const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
const { calculateDistance } = require('../../common/utils/geo');
const logger = require('../../config/logger');
const JobService = require('./job.service');

// Create a new job
// Cancel Job (New)
exports.cancelJob = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const job = await JobService.cancelJob(id, req.user._id, req.user.role, reason);
        res.json({ success: true, message: 'Job cancelled successfully', data: job });
    } catch (error) {
        logger.error('Cancel Job Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createJob = async (req, res) => {
    try {
        let { job_title, job_description, material_requirements, skill_required, location, urgency_level, quotation_window_hours } = req.body;

        // Handle stringified JSON from Multipart requests
        if (typeof location === 'string') {
            try {
                location = JSON.parse(location);
            } catch (e) {
                logger.warn('Failed to parse location JSON, keeping as is');
            }
        }

        // 1. Handle Image Uploads
        const issue_photos = [];
        if (req.files && req.files.length > 0) {
            logger.info(`Uploading ${req.files.length} job photos...`);
            const uploadPromises = req.files.map(file =>
                uploadOptimizedImage(file.buffer, `skillbridge/jobs/${req.user._id}`)
            );

            const uploadResults = await Promise.all(uploadPromises);
            uploadResults.forEach(result => issue_photos.push(result.url));
            logger.info(`Successfully uploaded ${issue_photos.length} photos`);
        }

        const jobData = {
            job_title,
            job_description,
            material_requirements,
            skill_required,
            location,
            urgency_level,
            quotation_window_hours,
            issue_photos
        };

        // Delegate content creation and constraints to Service
        const job = await JobService.createJob(jobData, req.user);

        res.status(201).json({
            success: true,
            message: 'Job posted successfully',
            data: job
        });

    } catch (error) {
        logger.error('Create Job Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to post job'
        });
    }
};



exports.getJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id)
            .populate('user_id', 'name phone address profileImage')
            .populate('selected_worker_id', 'name phone profileImage');

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // --- AUTHORIZATION CHECK ---
        if (req.user && req.user.role !== 'admin') {
            if (req.user.role === 'user') {
                // Tenant can only view their own jobs
                if (job.user_id._id.toString() !== req.user._id.toString()) {
                    return res.status(403).json({ success: false, message: 'Not authorized to view this job' });
                }
            } else if (req.user.role === 'worker') {
                // Worker can view if job is open OR if they are the assigned worker
                const isAssignedWorker = job.selected_worker_id && job.selected_worker_id._id.toString() === req.user._id.toString();
                if (job.status !== 'open' && !isAssignedWorker) {
                    return res.status(403).json({
                        success: false,
                        message: 'Job is no longer available or has been assigned to another worker.',
                        errorCode: 'JOB_UNAVAILABLE'
                    });
                }
            }
        }
        // ---------------------------

        // Check if current user (worker) has already submitted a quotation
        let hasSubmittedQuotation = false;
        if (req.user && req.user.role === 'worker') {
            const Quotation = require('../quotations/quotation.model');
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            hasSubmittedQuotation = !!existingQuotation;
        }

        // Check if current user is the Job Owner (Tenant)
        let start_otp = undefined;
        if (req.user && job.user_id._id.toString() === req.user._id.toString()) {
            // Need to explicitly fetch the hidden OTP field
            const jobWithOtp = await Job.findById(req.params.id).select('+start_otp');
            if (jobWithOtp) {
                start_otp = jobWithOtp.start_otp;
            }
        }

        res.json({
            success: true,
            data: {
                ...job._doc,
                hasSubmittedQuotation,
                start_otp // Will be undefined for non-owners
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.acceptJob = async (req, res) => {
    return res.status(400).json({ success: false, message: 'Direct acceptance is disabled. Please wait for Quotation System in Phase 3.' });
};

// Get jobs feed for a worker (matching skills and location)
exports.getWorkerFeed = async (req, res) => {
    try {
        const jobs = await JobService.getWorkerFeed(req.user._id);

        // Enhance with hasSubmittedQuotation flag
        const Quotation = require('../quotations/quotation.model');
        const jobsWithFlags = await Promise.all(jobs.map(async (job) => {
            const existingQuotation = await Quotation.findOne({ job_id: job._id, worker_id: req.user._id });
            return {
                ...job,
                hasSubmittedQuotation: !!existingQuotation
            };
        }));

        res.json({ success: true, data: jobsWithFlags });

    } catch (error) {
        if (error.code === 'WORKER_NOT_VERIFIED') {
            return res.status(403).json({
                success: false,
                message: error.message,
                errorCode: 'WORKER_NOT_VERIFIED'
            });
        }
        console.error('Get Worker Feed Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch jobs: ' + error.message });
    }
};

// Get jobs assigned to the worker
exports.getWorkerJobs = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {
            selected_worker_id: req.user._id
        };

        if (status === 'active') {
            query.status = { $in: ['assigned', 'eta_confirmed', 'on_the_way', 'arrived', 'diagnosis_mode', 'diagnosed', 'material_pending_approval', 'in_progress', 'reviewing', 'cooling_window'] };
        } else if (status === 'completed') {
            query.status = 'completed';
        }

        const jobs = await Job.find(query)
            .sort({ updated_at: -1 })
            .populate('user_id', 'name phone address profileImage');

        res.json({ success: true, data: jobs });

    } catch (error) {
        console.error('Get Worker Jobs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch jobs' });
    }
};

// Get jobs posted by the tenant (user)
exports.getTenantJobs = async (req, res) => {
    try {
        const { status } = req.query; // 'open' (pending) or 'active' (in_progress)
        let query = {
            user_id: req.user._id
        };

        if (status === 'pending') {
            query.status = 'open';
        } else if (status === 'active') {
            query.status = { $in: ['assigned', 'eta_confirmed', 'on_the_way', 'arrived', 'diagnosis_mode', 'diagnosed', 'material_pending_approval', 'in_progress', 'reviewing', 'cooling_window'] };
        } else if (status === 'completed') {
            query.status = 'completed';
        }

        const jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .populate('selected_worker_id', 'name phone profileImage'); // Populate worker details if assigned

        res.json({ success: true, data: jobs });

    } catch (error) {
        console.error('Get Tenant Jobs Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch your jobs' });
    }
};

// Start Job (Phase 4: Worker enters OTP)
// Start Job (Phase 4: Worker enters OTP)
// Worker confirms arrival (Replaces startJob)
// Worker confirms arrival (Replaces startJob)
// B1. Confirm ETA
exports.confirmEta = async (req, res) => {
    try {
        const { id } = req.params;
        const { etaTime } = req.body;
        const job = await JobService.confirmEta(id, req.user._id, etaTime);
        res.json({ success: true, message: 'ETA Confirmed', data: job });
    } catch (error) {
        logger.error('Confirm ETA Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B2. Start Journey
exports.startJourney = async (req, res) => {
    try {
        const { id } = req.params;
        let { location } = req.body;
        if (typeof location === 'string') {
            try { location = JSON.parse(location); } catch (e) { }
        }
        const job = await JobService.startJourney(id, req.user._id, location);
        res.json({ success: true, message: 'Journey Started', data: job });
    } catch (error) {
        logger.error('Start Journey Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B3. Arrive (Replaces old confirmArrival)
exports.arrive = async (req, res) => {
    try {
        const { id } = req.params;
        let { location } = req.body;
        if (typeof location === 'string') {
            try { location = JSON.parse(location); } catch (e) { }
        }
        const job = await JobService.arrive(id, req.user._id, location);
        res.json({ success: true, message: 'Arrival Confirmed', data: job });
    } catch (error) {
        logger.error('Arrive Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B4. Report Delay
exports.reportDelay = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, delayMinutes } = req.body;
        const job = await JobService.reportDelay(id, req.user._id, reason, delayMinutes);
        res.json({ success: true, message: 'Delay reported', data: job });
    } catch (error) {
        logger.error('Report Delay Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B4b. Start Job (OTP)
exports.startJob = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;
        const job = await JobService.startJob(id, req.user._id, otp);
        res.json({ success: true, message: 'Job Started', data: job });
    } catch (error) {
        logger.error('Start Job Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// B5. Update Location
exports.updateLocation = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng, isMock } = req.body;
        const job = await JobService.updateLocation(id, req.user._id, lat, lng, isMock);
        res.json({ success: true, message: 'Location updated', data: job });
    } catch (error) {
        // Log at debug/info level to avoid spamming errors for location updates
        logger.debug('Update Location Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Diagnosis Mode
exports.submitDiagnosis = async (req, res) => {
    try {
        const { id } = req.params;
        const diagnosisData = req.body; // materials, final_labor_cost, etc.
        const job = await JobService.submitDiagnosis(id, req.user._id, diagnosisData);
        res.json({ success: true, message: 'Diagnosis submitted', data: job });
    } catch (error) {
        logger.error('Submit Diagnosis Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.approveDiagnosis = async (req, res) => {
    try {
        const { id } = req.params;
        const { approved, rejectionReason } = req.body;
        const job = await JobService.approveDiagnosis(id, req.user._id, approved, rejectionReason);
        res.json({ success: true, message: approved ? 'Diagnosis approved, job started' : 'Diagnosis rejected', data: job });
    } catch (error) {
        logger.error('Approve Diagnosis Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Material Requests
exports.requestMaterial = async (req, res) => {
    try {
        const { id } = req.params;
        const requestData = req.body;
        const billProofFile = req.file; // From uploadSingle('bill_proof')

        const job = await JobService.requestMaterial(id, req.user._id, requestData, billProofFile);
        res.json({ success: true, message: 'Material requested', data: job });
    } catch (error) {
        logger.error('Request Material Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.respondToMaterial = async (req, res) => {
    try {
        const { id, requestId } = req.params;
        const { approved } = req.body;
        const job = await JobService.respondToMaterial(id, req.user._id, requestId, approved);
        res.json({ success: true, message: 'Material response recorded', data: job });
    } catch (error) {
        logger.error('Respond Material Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Worker submits completion proof
exports.submitCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const { summary } = req.body;

        // When using uploadFields, req.files is an object keyed by fieldname
        const completionFiles = req.files['completion_photos'] || [];
        const signatureFile = req.files['signature'] ? req.files['signature'][0] : null;

        const job = await JobService.submitCompletion(id, req.user._id, completionFiles, summary, signatureFile);
        res.json({ success: true, message: 'Completion proof submitted. Waiting for tenant confirmation.', data: job });
    } catch (error) {
        logger.error('Submit Completion Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to submit completion' });
    }
};

// Tenant confirms completion (Starts Cooling Window)
exports.confirmCompletion = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.confirmCompletion(id, req.user._id);
        res.json({ success: true, message: 'Work accepted. Cooling period started.', data: job });
    } catch (error) {
        logger.error('Confirm Completion Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to confirm completion' });
    }
};

// Finalize (Post Cooling)
exports.finalizeJob = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.finalizeJob(id); // Usually triggered by system, but maybe admin/user manual trigger
        res.json({ success: true, message: 'Job finalized and payment released', data: job });
    } catch (error) {
        logger.error('Finalize Job Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Disputes
exports.raiseDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const job = await JobService.raiseDispute(id, req.user._id, reason, req.files);
        res.json({ success: true, message: 'Dispute raised', data: job });
    } catch (error) {
        logger.error('Raise Dispute Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.resolveDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { decision, notes } = req.body; // admin only
        const job = await JobService.resolveDispute(id, req.user._id, decision, notes);
        res.json({ success: true, message: 'Dispute resolved', data: job });
    } catch (error) {
        logger.error('Resolve Dispute Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Warranty
exports.claimWarranty = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const job = await JobService.claimWarranty(id, req.user._id, reason);
        res.json({ success: true, message: 'Warranty claim raised', data: job });
    } catch (error) {
        logger.error('Claim Warranty Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.resolveWarranty = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await JobService.resolveWarranty(id, req.user._id);
        res.json({ success: true, message: 'Warranty claim resolved', data: job });
    } catch (error) {
        logger.error('Resolve Warranty Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Invoices & Receipts
exports.getInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await Job.findById(id)
            .populate('user_id', 'name email address')
            .populate('selected_worker_id', 'name');

        if (!job) return res.status(404).send('Invoice not found');

        const PaymentService = require('../payments/payment.service');
        const breakdown = await PaymentService.calculateBreakdown(job.diagnosis_report.final_total_cost, job.selected_worker_id._id);
        const materialCost = (job.diagnosis_report.materials || []).reduce((sum, m) => sum + (m.estimated_cost || 0), 0);
        const laborCost = job.diagnosis_report.final_labor_cost || (job.diagnosis_report.final_total_cost - materialCost);

        const invoiceDate = new Date().toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; margin: 0; padding: 40px; background: #fff; }
                .invoice-box { max-width: 800px; margin: auto; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #6366f1; padding-bottom: 20px; margin-bottom: 40px; }
                .logo { font-size: 28px; font-weight: bold; color: #6366f1; }
                .invoice-details { text-align: right; }
                .section { margin-bottom: 30px; }
                .section-title { font-weight: bold; color: #666; font-size: 12px; text-transform: uppercase; margin-bottom: 10px; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
                table { width: 100%; line-height: inherit; text-align: left; border-collapse: collapse; }
                table th { background: #f8fafc; padding: 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
                table td { padding: 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
                .total-row { background: #6366f1 !important; color: white !important; font-weight: bold; }
                .total-row td { border: none; padding: 15px 12px; font-size: 18px; color: white !important; }
                .footer { margin-top: 60px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                .badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: bold; }
                .badge-success { background: #dcfce7; color: #166534; }
            </style>
        </head>
        <body>
            <div class="invoice-box">
                <div class="header">
                    <div>
                        <div class="logo">SkillBridge</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 5px;">Professional Service Marketplace</div>
                    </div>
                    <div class="invoice-details">
                        <h1 style="margin: 0; font-size: 24px;">TAX INVOICE</h1>
                        <div style="margin-top: 5px; color: #64748b;">#INV-${job._id.toString().slice(-6).toUpperCase()}</div>
                        <div style="font-size: 14px; margin-top: 5px;">Date: ${invoiceDate}</div>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; margin-bottom: 40px;">
                    <div style="flex: 1;">
                        <div class="section-title">Billed To (Tenant)</div>
                        <div style="font-weight: bold; font-size: 16px;">${job.user_id.name}</div>
                        <div style="font-size: 14px; color: #475569; margin-top: 4px;">${job.user_id.email || ''}</div>
                        <div style="font-size: 14px; color: #475569;">${job.location?.address || 'N/A'}</div>
                    </div>
                    <div style="flex: 1; text-align: right;">
                        <div class="section-title">Service Provider (Worker)</div>
                        <div style="font-weight: bold; font-size: 16px;">${job.selected_worker_id?.name || 'Worker'}</div>
                        <div style="font-size: 14px; color: #475569; margin-top: 4px;">Verified SkillBridge Partner</div>
                        <div style="margin-top: 8px;">
                            <span class="badge badge-success">PAID VIA ESCROW</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Service Description</div>
                    <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">${job.job_title}</div>
                    <div style="color: #475569; font-size: 14px;">Complete professional service delivered.</div>
                </div>

                <div class="section">
                    <table>
                        <thead>
                            <tr>
                                <th>Description</th>
                                <th style="text-align: right;">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <strong>Professional Service Fee</strong><br>

                                    <small style="color: #64748b;">Labor and expertise charge</small>
                                </td>
                                <td style="text-align: right;">₹${laborCost.toFixed(2)}</td>
                            </tr>
                            ${materialCost > 0 ? `
                            <tr>
                                <td>
                                    <strong>Material Expenses</strong><br>
                                    <small style="color: #64748b;">Parts and materials supplied</small>
                                </td>
                                <td style="text-align: right;">₹${materialCost.toFixed(2)}</td>
                            </tr>
                            ` : ''}

                            <tr>
                                <td>
                                    <strong>Platform Protection Fee</strong><br>
                                    <small style="color: #64748b;">Secure escrow and support coverage</small>
                                </td>
                                <td style="text-align: right;">₹${breakdown.protectionFee.toFixed(2)}</td>
                            </tr>
                            <tr class="total-row">
                                <td style="color: white !important;">Total Amount (Paid)</td>
                                <td style="text-align: right; color: white !important;">₹${breakdown.totalUserPayable.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div style="margin-top: 40px; padding: 20px; background: #eff6ff; border-radius: 12px; font-size: 13px; color: #1e40af;">
                    <strong>Note:</strong> This document serves as proof of payment for services rendered. The total amount has been successfully settled from the tenant's wallet through the SkillBridge secure platform.
                </div>

                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} SkillBridge. All rights reserved.</p>
                    <p>SkillBridge Technologies Pvt Ltd | support@skillbridge.com</p>
                </div>
            </div>
        </body>
        </html>
        `;

        // Generate PDF if requested
        if (req.query.format === 'pdf') {
            try {
                const PDFService = require('../../common/services/pdf.service');
                const pdfBuffer = await PDFService.generatePDF(html);

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename="invoice-SB-${job._id.toString().slice(-6).toUpperCase()}.pdf"`);
                res.send(pdfBuffer);
            } catch (pdfError) {
                // Fallback to HTML if PDF generation fails
                logger.error(`PDF generation failed: ${pdfError.message}`);
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Content-Disposition', `inline; filename="invoice-${job._id}.html"`);
                res.send(html);
            }
        } else {
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        }
    } catch (e) {
        res.status(500).send(e.message);
    }
};

exports.getWarrantyCard = async (req, res) => {
    try {
        const { id } = req.params;
        const job = await Job.findById(id).populate('selected_worker_id', 'name');

        if (!job || !job.diagnosis_report.warranty_offered) {
            return res.status(404).send('Warranty not found or not offered for this job');
        }

        const completedAt = job.completed_at || job.updated_at;
        const expiry = new Date(completedAt.getTime() + job.diagnosis_report.warranty_duration_days * 24 * 60 * 60 * 1000);
        const isExpired = new Date() > expiry;
        const statusHtml = isExpired
            ? '<div class="status" style="background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;">EXPIRED WARRANTY</div>'
            : '<div class="status">ACTIVE WARRANTY</div>';

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; padding: 50px; }
                .warranty-card { max-width: 600px; margin: auto; background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 2px solid ${isExpired ? '#991b1b' : '#10b981'}; }
                .top-bar { background: ${isExpired ? '#991b1b' : '#10b981'}; padding: 30px; text-align: center; color: white; }
                .content { padding: 40px; }
                .info-row { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px dashed #eee; padding-bottom: 10px; }
                .label { color: #666; font-size: 14px; }
                .value { font-weight: 600; color: #333; }
                .status { background: #f0fdf4; color: #166534; padding: 10px; text-align: center; border-radius: 8px; font-weight: bold; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="warranty-card">
                <div class="top-bar">
                    <h1 style="margin: 0; font-size: 24px;">🛡️ Warranty Certificate</h1>
                    <p style="margin: 5px 0 0 0; opacity: 0.9;">Professional Service Guarantee</p>
                </div>
                <div class="content">
                    <div class="info-row">
                        <span class="label">Job Reference</span>
                        <span class="value">#${job._id.toString().slice(-8).toUpperCase()}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Service Title</span>
                        <span class="value">${job.job_title}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Provider</span>
                        <span class="value">${job.selected_worker_id.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Duration</span>
                        <span class="value">${job.diagnosis_report.warranty_duration_days} Days</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Valid Until</span>
                        <span class="value" style="color: #ef4444;">${expiry.toLocaleDateString()}</span>
                    </div>
                    ${statusHtml}
                    <p style="font-size: 12px; color: #999; margin-top: 30px; line-height: 1.4;">
                        This warranty covers defects related to the specific labor performed. It does not cover new issues or material wear and tear unless specified. Contact through SkillBridge for claims.
                    </p>
                </div>
            </div>
        </body>
        </html>
        `;
        res.send(html);
    } catch (e) {
        res.status(500).send(e.message);
    }
};

// Get all unique job categories (skills)
exports.getJobCategories = async (req, res) => {
    try {
        // Fetch distinct 'skill_required' from the Job collection
        const categories = await Job.distinct('skill_required');

        // Return the list of categories
        res.json({
            success: true,
            data: categories.filter(c => c) // Filter out null/undefined
        });
    } catch (error) {
        logger.error('Get Job Categories Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
};


/**
 * Claim Warranty
 */
exports.claimWarranty = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        let evidence = [];
        if (req.files && req.files.length > 0) {
            const { uploadOptimizedImage } = require('../../common/services/cloudinary.service');
            const uploadPromises = req.files.map(file => uploadOptimizedImage(file.buffer, `skillbridge/warranty/${id}`));
            const uploadResults = await Promise.all(uploadPromises);
            evidence = uploadResults.map(r => r.url);
        }

        const job = await JobService.claimWarranty(id, req.user._id, reason, evidence);
        res.json({ success: true, message: 'Warranty claim raised successfully', data: job });
    } catch (error) {
        logger.error('Claim Warranty Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Resolve Warranty
 */
exports.resolveWarranty = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolutionNote } = req.body;
        const job = await JobService.resolveWarranty(id, req.user._id, resolutionNote);
        res.json({ success: true, message: 'Warranty claim resolved successfully', data: job });
    } catch (error) {
        logger.error('Resolve Warranty Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
