const Quotation = require('./quotation.model');
const Job = require('../jobs/job.model');
const Worker = require('../workers/worker.model');
const Notification = require('../notifications/notification.model');
const cloudinaryService = require('../../common/services/cloudinary.service');
const emailService = require('../../common/services/email.service');
const logger = require('../../config/logger');

// Constraints / Business Logic Constants
const MAX_VIDEO_DURATION_SECONDS = 30;

exports.createQuotation = async (quotationData, user, videoFile) => {
    // 1. Worker Verification Constraint
    const workerProfile = await Worker.findOne({ user: user._id });
    if (!workerProfile) throw new Error('Worker profile not found');
    if (workerProfile.verificationStatus !== 'verified') {
        const err = new Error('Access denied. Your profile is under verification.');
        err.code = 'WORKER_NOT_VERIFIED';
        throw err;
    }

    // 2. Validate Job
    const job = await Job.findById(quotationData.job_id);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'open') throw new Error('Job is not open for quotations');

    // 3. Validate Time Window
    if (job.quotation_end_time && new Date() > job.quotation_end_time) {
        throw new Error('Quotation submission window has closed');
    }

    // 4. Validate Duplicate
    const existing = await Quotation.findOne({ job_id: quotationData.job_id, worker_id: user._id });
    if (existing) throw new Error('You have already submitted a quotation for this job');

    // Constraint: Max 10 bids per job
    const bidCount = await Quotation.countDocuments({ job_id: quotationData.job_id });
    if (bidCount >= 10) {
        throw new Error('This job has reached the maximum number of bids (10).');
    }

    // 5. Availability Check (Clash Prevention)
    const { isWorkerAvailable } = require('../workers/worker.controller');
    if (job.preferred_start_time) {
        const available = await isWorkerAvailable(workerProfile._id, job.preferred_start_time);
        if (!available) {
            throw new Error('You have a scheduling conflict at the requested job time. Please update your availability.');
        }
    }


    // 5. Handling Video Pitch (Validation Constraint: duration <= 30s)
    let video_url = null;
    if (videoFile) {
        // Upload with resource_type: 'video' to get duration
        const uploadResult = await cloudinaryService.uploadFile(videoFile.buffer, 'skillbridge/quotations', {
            resource_type: 'video'
        });

        // Cloudinary returns duration in seconds
        if (uploadResult.duration && uploadResult.duration > MAX_VIDEO_DURATION_SECONDS) {
            // Rollback upload
            await cloudinaryService.deleteImage(uploadResult.public_id || uploadResult.public_id);
            throw new Error(`Video pitch must be ${MAX_VIDEO_DURATION_SECONDS} seconds or less.`);
        }
        video_url = uploadResult.url;
    }

    // 6. Calculate Cost & Constraint: Amount > 0
    const labor_cost = Number(quotationData.labor_cost);
    const material_cost = Number(quotationData.material_cost || 0);
    const total_cost = labor_cost + material_cost;

    if (total_cost <= 0) {
        throw new Error('Total quotation amount must be greater than zero.');
    }

    // 7. Suspicious Pricing Detection
    let warning = null;

    // Check against global market average for this skill
    const marketStats = await Quotation.aggregate([
        {
            $lookup: {
                from: 'jobs',
                localField: 'job_id',
                foreignField: '_id',
                as: 'job'
            }
        },
        { $unwind: '$job' },
        { $match: { 'job.skill_required': job.skill_required, status: 'accepted' } },
        { $group: { _id: null, avg: { $avg: '$total_cost' }, count: { $sum: 1 } } }
    ]);

    if (marketStats.length > 0 && marketStats[0].count >= 3) {
        const marketAvg = marketStats[0].avg;
        if (total_cost < (marketAvg * 0.4)) {
            warning = '⚠️ Suspiciously Low Price: Your quote is less than 40% of the market average for this skill. This may lead to job rejection or system flags for quality concerns.';
        } else if (total_cost < (marketAvg * 0.3)) {
            // Extremely low price - trigger fraud detection
            try {
                const fraudDetectionService = require('../fraud/fraud-detection.service');
                await fraudDetectionService.detectSuspiciousPricing(null, job._id, user._id, total_cost);
            } catch (err) {
                logger.error(`Failed to create fraud alert for suspicious pricing: ${err.message}`);
            }
        } else if (total_cost > (marketAvg * 2.5)) {
            warning = '🚩 High Price Alert: Your quote is more than 2.5x the market average. Ensure your premium pricing is justified in your notes/video.';
        }
    } else {
        // Fallback: Calculate average of other quotes for this specific job
        const otherQuotes = await Quotation.aggregate([
            { $match: { job_id: job._id } },
            { $group: { _id: null, avg: { $avg: '$total_cost' } } }
        ]);

        if (otherQuotes.length > 0 && otherQuotes[0].avg > 0) {
            const avg = otherQuotes[0].avg;
            if (total_cost < (avg * 0.5)) {
                warning = 'Your quotation is significantly lower than other bidders. Ensure you have calculated costs correctly.';
            }
        }
    }

    // A. Rule-Based Ranking Engine
    const rScore = (workerProfile.reliabilityScore || 50) + ((workerProfile.rating || 0) * 10);
    let rTier = 'entry';
    if (rScore >= 130) rTier = 'top'; // e.g. 80 reliability + 5.0 rating = 130
    else if (rScore >= 90) rTier = 'standard';

    const quotation = new Quotation({
        job_id: quotationData.job_id,
        worker_id: user._id,
        labor_cost,
        material_cost,
        total_cost,
        estimated_days: Number(quotationData.estimated_days),
        notes: quotationData.notes,
        tags: quotationData.tags,
        arrival_time: quotationData.arrival_time ? new Date(quotationData.arrival_time) : undefined,
        completion_time: quotationData.completion_time ? new Date(quotationData.completion_time) : undefined,
        warranty: quotationData.warranty,
        video_url,
        rankingScore: rScore,
        tier: rTier
    });

    await quotation.save();

    // 8. Notify Tenant
    await Notification.create({
        recipient: job.user_id,
        title: 'New Quotation Received',
        message: `You have received a new quotation for your job: ${job.job_title}`,
        type: 'quotation_received',
        data: { jobId: job._id, quotationId: quotation._id }
    });

    return { quotation, warning };
};

exports.getQuotationsForJob = async (jobId, userId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    // Only Tenant can view
    if (job.user_id.toString() !== userId.toString()) {
        throw new Error('Not authorized to view quotations for this job');
    }

    const quotations = await Quotation.find({ job_id: jobId })
        .populate('worker_id', 'name phone profileImage');

    const workerUserIds = quotations.map(q => q.worker_id._id);
    const workers = await Worker.find({ user: { $in: workerUserIds } });

    // Transform
    const enriched = quotations.map(q => {
        const workerProfile = workers.find(w => w.user.toString() === q.worker_id._id.toString());
        const jobsCompleted = workerProfile && workerProfile.reputation_zones
            ? workerProfile.reputation_zones.reduce((sum, z) => sum + z.jobs_completed, 0)
            : 0;

        // Ensure we use the real image (selfie) if profileImage is missing
        const workerUser = q.worker_id.toObject ? q.worker_id.toObject() : q.worker_id;
        if (!workerUser.profileImage && workerProfile && workerProfile.selfie) {
            workerUser.profileImage = workerProfile.selfie;
        }

        return {
            ...q.toObject(),
            worker_id: workerUser,
            worker_rating: workerProfile ? workerProfile.rating : 0,
            worker_reliability: workerProfile ? workerProfile.reliabilityScore : 0,
            worker_jobs_completed: jobsCompleted,
            worker_verified: workerProfile ? workerProfile.verificationStatus === 'verified' : false
        };
    });

    // Sort: Ranking Score (Desc) -> Lowest Price (Asc) -> Rating (Desc)
    enriched.sort((a, b) => {
        // Use pre-calculated ranking score if available (falling back to 0 just in case)
        const scoreA = a.rankingScore || 0;
        const scoreB = b.rankingScore || 0;

        if (scoreB !== scoreA) return scoreB - scoreA; // High score first
        if (a.total_cost !== b.total_cost) return a.total_cost - b.total_cost; // Low price first
        return b.worker_rating - a.worker_rating;
    });

    return enriched;
};

exports.acceptQuotation = async (quotationId, userId) => {
    const quotation = await Quotation.findById(quotationId).populate('job_id').populate('worker_id', 'name email');
    if (!quotation) throw new Error('Quotation not found');

    const job = quotation.job_id;
    if (job.user_id.toString() !== userId.toString()) throw new Error('Not authorized');

    // Constraint: Can't quote on closed/assigned jobs (redundant check but safe)
    if (job.status !== 'open') throw new Error('Job is not open');

    // Update Job
    job.status = 'assigned';
    job.selected_worker_id = quotation.worker_id._id;
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    job.start_otp = otp;
    job.start_otp_expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 Hours Expiry
    // job.timeline = job.timeline || []; // Ensure timeline exists
    // job.timeline.push({ status: 'assigned', actor: 'user', note: 'Worker hired. OTP generated.' });
    const { appendTimeline } = require('../jobs/job.service');
    appendTimeline(job, 'assigned', 'user', 'Worker hired. OTP generated.');

    await job.save();

    // Update Quotation
    quotation.status = 'accepted';
    await quotation.save();

    // Constraint: Selecting a quotation must lock all others
    await Quotation.updateMany(
        { job_id: job._id, _id: { $ne: quotationId } },
        { $set: { status: 'rejected' } }
    );

    // Notification Logic
    // ... Notify Worker In-App
    await Notification.create({
        recipient: quotation.worker_id._id,
        title: 'Quotation Accepted!',
        message: `Your quotation for ${job.job_title} has been accepted. You can now start the work.`,
        type: 'quotation_accepted',
        data: { jobId: job._id }
    });

    // ... Notify Tenant
    await Notification.create({
        recipient: job.user_id,
        title: 'Share OTP with Worker',
        message: `You have hired ${quotation.worker_id.name}. Otp: ${otp}`,
        type: 'system',
        data: { jobId: job._id, otp }
    });

    // ... Email
    if (quotation.worker_id.email) {
        await emailService.sendQuotationAcceptedEmail(
            quotation.worker_id.email,
            quotation.worker_id.name,
            job.job_title,
            quotation.total_cost
        );
    }

    return job;
};
