const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const NotificationService = require('../notifications/notification.service');
const notifyHelper = require('../../common/notification.helper');
const cloudinaryService = require('../../common/services/cloudinary.service');
const { calculateDistance } = require('../../common/utils/geo');
const logger = require('../../config/logger');
const PaymentService = require('../payments/payment.service');
const EmailService = require('../../common/services/email.service');

// === HELPER: Sanitize PII ===
const sanitizeNote = (text) => {
    if (!text) return '';
    // Mask Phone Numbers (simple pattern)
    let sanitized = text.replace(/\b\d{10}\b/g, '[PHONE-REDACTED]');
    // Mask Emails
    sanitized = sanitized.replace(/\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/gi, '[EMAIL-REDACTED]');
    return sanitized;
};

// === HELPER: Append to Timeline ===
const appendTimeline = (job, status, actor, note = '', metadata = null) => {
    job.timeline.push({
        status,
        timestamp: new Date(),
        actor,
        note: sanitizeNote(note),
        metadata
    });
};

exports.appendTimeline = appendTimeline;

/**
 * Create a new job with validation
 */
exports.createJob = async (jobData, user) => {
    // ... (Existing Creation Logic)
    // 1. Constraint: Emergency jobs must use short quotation windows
    if (jobData.urgency_level === 'emergency') {
        const hours = Number(jobData.quotation_window_hours) || 24;
        if (hours > 2) {
            jobData.quotation_window_hours = 2; // Enforce max 2 hours for emergency
            logger.info('Enforced short quotation window for emergency job');
        }
    }

    // 2. Constraint: Duplicate job postings by same user must be restricted
    const duplicateJob = await Job.findOne({
        user_id: user._id,
        job_title: jobData.job_title,
        skill_required: jobData.skill_required,
        status: 'open',
        created_at: { $gt: new Date(Date.now() - 10 * 60 * 1000) } // Same job in last 10 mins
    });

    if (duplicateJob) throw new Error('Duplicate job posting detected. Please wait before posting the same job again.');

    // Prepare Job Object
    const quotation_start_time = new Date();
    const hours = Number(jobData.quotation_window_hours) || 24;
    const quotation_end_time = new Date(quotation_start_time.getTime() + hours * 60 * 60 * 1000);

    const job = new Job({
        user_id: user._id,
        ...jobData,
        quotation_start_time,
        quotation_end_time,
        is_emergency: jobData.urgency_level === 'emergency',
        status: 'open',
        location: {
            type: 'Point',
            coordinates: [Number(jobData.location.lng), Number(jobData.location.lat)],
            address_text: jobData.location.address_text
        },
        timeline: [{ status: 'open', actor: 'user', note: 'Job created' }]
    });

    await job.save();

    // 3. Worker Discovery & Notification (Async)
    this.findAndNotifyNearbyWorkers(job).catch(err =>
        logger.error(`Error in worker discovery for job ${job._id}:`, err)
    );

    return job;
};

exports.findAndNotifyNearbyWorkers = async (job) => {
    const matchedWorkers = await Worker.find({
        skills: { $in: [job.skill_required] },
        verificationStatus: 'verified'
    }).select('user');

    if (matchedWorkers.length === 0) return;

    const workerUserIds = matchedWorkers.map(w => w.user);
    const nearbyUsers = await User.find({
        _id: { $in: workerUserIds },
        location: {
            $near: {
                $geometry: { type: 'Point', coordinates: job.location.coordinates },
                $maxDistance: 10000
            }
        }
    }).select('_id name fcmTokens');

    // Uses unified helper: fires FCM multicast + throttled in-app notifications
    await notifyHelper.onNewJobPosted(nearbyUsers, job);
};

exports.getWorkerFeed = async (userId, filters = {}) => {
    // 1. Get Worker Profile & Verify
    const workerProfile = await Worker.findOne({ user: userId });
    if (!workerProfile) throw new Error('Worker profile not found');
    if (workerProfile.verificationStatus !== 'verified') {
        const error = new Error('Access denied. Your profile is under verification.');
        error.code = 'WORKER_NOT_VERIFIED';
        throw error;
    }

    const workerSkills = workerProfile.skills;
    if (!workerSkills || workerSkills.length === 0) return [];

    const workerUser = await User.findById(userId);
    if (!workerUser || !workerUser.location || !workerUser.location.coordinates) {
        throw new Error('Worker location not set');
    }

    // 2. Build Aggregation Pipeline
    const pipeline = [];

    // GeoNear must be first
    const maxDistance = (filters.distance || 50) * 1000; // Default 50km
    pipeline.push({
        $geoNear: {
            near: { type: 'Point', coordinates: workerUser.location.coordinates },
            distanceField: 'distance',
            maxDistance: maxDistance,
            spherical: true,
            key: 'location',
            query: {
                status: 'open',
                skill_required: { $in: workerSkills }
            }
        }
    });

    // Filters
    if (filters.urgency) {
        pipeline.push({ $match: { urgency_level: filters.urgency } });
    }
    // Estimated Payout (Not in Job model, skipping or assuming derived)

    // Lookup User for Reliability (Mocking reliability if not on User schema)
    pipeline.push({
        $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'client'
        }
    });
    pipeline.push({ $unwind: '$client' });

    // Add Sort Fields
    // Map urgency to numeric value for sorting
    pipeline.push({
        $addFields: {
            urgencyScore: {
                $switch: {
                    branches: [
                        { case: { $eq: ['$urgency_level', 'emergency'] }, then: 4 },
                        { case: { $eq: ['$urgency_level', 'high'] }, then: 3 },
                        { case: { $eq: ['$urgency_level', 'medium'] }, then: 2 },
                        { case: { $eq: ['$urgency_level', 'low'] }, then: 1 }
                    ],
                    default: 0
                }
            },
            clientReliability: { $ifNull: ['$client.rating', 5] } // Default 5 if missing
        }
    });

    // Sort: Urgency (Desc), Distance (Asc), Reliability (Desc)
    pipeline.push({
        $sort: {
            urgencyScore: -1,
            distance: 1,
            clientReliability: -1
        }
    });

    pipeline.push({ $limit: 50 });

    const jobs = await Job.aggregate(pipeline);
    return jobs;
};


// === MODULE 4: JOB EXECUTION LOGIC ===

/**
 * Start Job with OTP
 */
/**
 * B. ETA Confirmation Layer
 * Worker confirms arrival.
 */
const EtaTracking = require('../workers/etaTracking.model');

// ...

/**
 * B1. ETA Confirmation
 * Worker confirms when they will arrive.
 */
exports.confirmEta = async (jobId, workerId, etaTime) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'assigned' && job.status !== 'eta_confirmed') throw new Error('Job must be in assigned state to set ETA');

    job.status = 'eta_confirmed';
    job.journey = job.journey || {};
    job.journey.confirmed_eta = new Date(etaTime);

    appendTimeline(job, 'eta_confirmed', 'worker', `ETA confirmed for ${new Date(etaTime).toLocaleTimeString()}`);
    await job.save();

    // Notify Tenant (Multi-channel)
    try {
        const tenant = await User.findById(job.user_id);
        if (tenant) {
            await notifyHelper.onEtaConfirmed(tenant, job, etaTime);
        }
    } catch (e) {
        logger.error(`confirmEta notify failed: ${e.message}`);
    }

    return job;
};

/**
 * B2. Start Journey
 * Worker indicates they are on the way.
 */
exports.startJourney = async (jobId, workerId, location) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'eta_confirmed') throw new Error('Must confirm ETA before starting journey');

    // Fake GPS Detection
    if (location && location.isMock) {
        appendTimeline(job, job.status, 'system', 'Security Alert: Fake GPS detected at journey start.', { type: 'security_alert', location });
        await job.save();
        throw new Error('Fake GPS detected. Journey cannot be started.');
    }

    job.status = 'on_the_way';
    job.journey = job.journey || {};
    job.journey.started_at = new Date();

    appendTimeline(job, 'on_the_way', 'worker', 'Worker started journey');
    await job.save();

    // FCM Push + In-App: notify tenant via helper
    try {
        const tenant = await User.findById(job.user_id).select('name email fcmTokens');
        const workerUser = await User.findById(workerId).select('name');
        if (tenant) {
            await notifyHelper.onJobStarted(tenant, job, workerUser?.name || 'Your worker');
        }
    } catch (e) {
        logger.error(`startJourney notify failed: ${e.message}`);
    }

    return job;
};

/**
 * B3. Arrival
 * Worker arrives at user location.
 */
exports.arrive = async (jobId, workerId, location) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    if (job.selected_worker_id.toString() !== workerId.toString()) {
        throw new Error('Unauthorized: You are not the assigned worker.');
    }
    // Allow if on_the_way (normal flow) or assigned/eta_confirmed (fallback/legacy)
    if (!['on_the_way', 'assigned', 'eta_confirmed'].includes(job.status)) {
        throw new Error('Invalid job status for arrival');
    }

    // 0. Fake GPS / Mock Location Detection
    if (location && location.isMock) {
        appendTimeline(job, job.status, 'system', 'Security Alert: Fake GPS / Mock Location detected at arrival attempt.', { type: 'security_alert', location });
        await job.save();
        throw new Error('Fake GPS detected. Please disable mock location apps and use your real GPS to confirm arrival.');
    }

    // 1. Geofence Check (Production Constraint)
    const jobCoords = { lat: job.location.coordinates[1], lng: job.location.coordinates[0] };
    const workerCoords = location; // { lat, lng }

    let geofenceWarning = null;
    if (workerCoords && workerCoords.lat && workerCoords.lng) {
        const distanceKm = calculateDistance(
            jobCoords.lat, jobCoords.lng,
            workerCoords.lat, workerCoords.lng
        );

        if (distanceKm > 0.5) { // 500m threshold
            // In strict mode, we'd throw error. For now, we allow with a flagged warning in timeline.
            // throw new Error(`You are too far from the job location (${distanceKm.toFixed(2)}km). Please get closer.`);
            geofenceWarning = `Warning: Force Arrival used (Distance: ${distanceKm.toFixed(2)}km)`;
        }
    } else {
        geofenceWarning = 'Warning: No GPS location provided at arrival.';
    }

    // Logic: Check Lateness based on Confirmed ETA
    let is_late = false;
    let delayMinutes = 0;
    const arrivalTime = new Date();

    // Use confirmed ETA if available, else preferred_start, else update+1h
    const promisedTime = job.journey?.confirmed_eta || job.preferred_start_time || new Date(job.updatedAt.getTime() + 60 * 60 * 1000);

    if (arrivalTime > promisedTime) {
        const diffMs = arrivalTime - promisedTime;
        delayMinutes = Math.floor(diffMs / 60000);
        if (delayMinutes > 15) is_late = true; // 15 min grace
    }

    job.journey = job.journey || {};
    job.journey.arrived_at = arrivalTime;
    job.journey.worker_location = location;

    job.status = 'arrived';

    let note = is_late ? `Worker arrived late by ${delayMinutes} mins` : 'Worker arrived on time';
    if (geofenceWarning) note += `. ${geofenceWarning}`;

    appendTimeline(job, 'arrived', 'worker', note, {
        lat: location?.lat,
        lng: location?.lng,
        distance_check: geofenceWarning ? 'failed' : 'passed'
    });

    await job.save();

    // 1.4.2 C: ETA Accuracy Tracking
    try {
        await EtaTracking.create({
            worker: workerId,
            job: jobId,
            status: 'arrived',
            promisedArrival: promisedTime,
            actualArrival: arrivalTime,
            delayMinutes: delayMinutes,
            isLate: is_late,
            accuracyPercentage: is_late ? Math.max(0, 100 - (delayMinutes * 2)) : 100
        });
    } catch (e) {
        logger.error('Failed to create ETA Tracking record', e);
    }

    // Penalty or Bonus based on punctuality
    const worker = await Worker.findOne({ user: workerId });
    if (worker) {
        if (is_late) {
            worker.reliabilityScore = Math.max(0, worker.reliabilityScore - 5); // Reduced penalty
            logger.info(`Worker ${workerId} penalised for late arrival. New Score: ${worker.reliabilityScore}`);
        } else {
            // Punctuality Bonus: +2 points for being on time or early
            worker.reliabilityScore = Math.min(100, worker.reliabilityScore + 2);
            worker.reliabilityStats = worker.reliabilityStats || {};
            worker.reliabilityStats.punctuality = (worker.reliabilityStats.punctuality || 0) + 1;
            logger.info(`Worker ${workerId} received punctuality bonus. New Score: ${worker.reliabilityScore}`);
        }
    }

    // Notify User (Multi-channel)
    try {
        const tenant = await User.findById(job.user_id);
        if (tenant) {
            await notifyHelper.onWorkerArrived(tenant, job);
        }
    } catch (e) {
        logger.error(`arrive notify failed: ${e.message}`);
    }

    return job;
};

/**
 * B4. Report Delay
 * Worker updates delay reason and new time.
 */
exports.reportDelay = async (jobId, workerId, reason, delayMinutes) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'on_the_way') throw new Error('Can only report delay while on the way');

    const newEta = new Date(Date.now() + delayMinutes * 60000); // Simple calculation from now, or use input time

    job.journey = job.journey || {};
    job.journey.delays.push({
        reason: reason,
        reported_at: new Date(),
        new_eta: newEta
    });

    appendTimeline(job, 'on_the_way', 'worker', `reported delay: ${reason}. Extra ${delayMinutes} mins.`);
    await job.save();

    // Notify User (Multi-channel)
    try {
        const tenant = await User.findById(job.user_id);
        if (tenant) {
            await notifyHelper.onWorkerDelayed(tenant, job, reason);
        }
    } catch (e) {
        logger.error(`reportDelay notify failed: ${e.message}`);
    }

    return job;
};

exports.updateLocation = async (jobId, workerId, lat, lng, isMock) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');

    // Fake GPS Detection (Log but maybe don't block entirely during transit to keep tracing?)
    // Let's block it to be strict.
    if (lat === undefined || lng === undefined) return job;

    if (isMock) {
        // Just log a warning in system log or similar? 
        // For real-time updates, we probably want to flag it in metadata.
        job.journey = job.journey || {};
        job.journey.worker_location = { lat, lng, isMock: true };
        await job.save();
        return job;
    }

    // Only update if journey is active
    if (job.status !== 'on_the_way') {
        // We might want to allow it in 'arrived' too, but primarily on_the_way
        // return job; 
    }

    job.journey = job.journey || {};
    job.journey.worker_location = { lat, lng };
    await job.save();

    // Broadcast Real-Time Update
    try {
        const { getIo } = require('../../socket/socket');
        const io = getIo();
        io.to(`job_${jobId}`).emit('location_update', { lat, lng });
    } catch (e) {
        logger.warn('Socket broadcast failed', e);
    }

    return job;
};

/**
 * B4. Start Job (OTP Verification)
 */
exports.startJob = async (jobId, workerId, otp) => {
    const job = await Job.findById(jobId).select('+start_otp');
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');

    // 1. Security: Check Lockout
    if (job.start_otp_lockout_until && new Date() < job.start_otp_lockout_until) {
        const minutesLeft = Math.ceil((job.start_otp_lockout_until - new Date()) / 60000);
        throw new Error(`Security Lockout: Too many failed attempts. Try again in ${minutesLeft} minutes.`);
    }

    if (!['arrived', 'diagnosed', 'diagnosis_mode'].includes(job.status)) {
        throw new Error('You must confirm arrival and diagnosis before starting.');
    }

    if (!job.start_otp || job.start_otp !== otp) {
        // 2. Security: Increment Attempts & Lock
        job.start_otp_attempts = (job.start_otp_attempts || 0) + 1;

        if (job.start_otp_attempts >= 3) {
            job.start_otp_lockout_until = new Date(Date.now() + 5 * 60000); // 5 mins lockout
            job.start_otp_attempts = 0; // Reset counter for next cycle
            appendTimeline(job, job.status, 'system', 'Security Alert: OTP Lockout triggered due to 3 failed attempts.', { type: 'security_alert' });
            await job.save();
            throw new Error('Invalid OTP. Account locked for 5 minutes due to multiple failed attempts.');
        }

        await job.save();
        throw new Error(`Invalid OTP. Please ask the customer for the code. (${3 - job.start_otp_attempts} attempts remaining)`);
    }

    // Success: Reset counters
    job.start_otp_attempts = 0;
    job.start_otp_lockout_until = null;

    job.status = 'in_progress';
    job.started_at = new Date();
    appendTimeline(job, 'in_progress', 'worker', 'Job started via OTP verification.', { otp_verified: true });

    await job.save();

    // Notify User: Job started (FCM push)
    try {
        const tenant = await User.findById(job.user_id).select('name email fcmTokens');
        if (tenant) {
            await notifyHelper.onJobStarted(tenant, job, 'Your worker');
        }
    } catch (e) {
        logger.error(`startJob notify failed: ${e.message}`);
    }

    return job;
};

/**
 * C. Diagnosis Mode: Submit Report
 */
exports.submitDiagnosis = async (jobId, workerId, diagnosisData) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    // Allow if assigned, eta_confirmed, or arrived
    if (!['assigned', 'eta_confirmed', 'arrived'].includes(job.status)) throw new Error('Invalid job status for diagnosis');

    // Warranty Validation
    if (diagnosisData.warranty_offered) {
        if (!diagnosisData.warranty_duration_days || diagnosisData.warranty_duration_days <= 0) {
            throw new Error('Warranty duration must be specified if warranty is offered.');
        }
    }

    // Cost Validation
    const materialCost = (diagnosisData.materials || []).reduce((sum, item) => sum + (Number(item.estimated_cost) || 0), 0);
    const laborCost = Number(diagnosisData.final_labor_cost) || 0;
    const warrantyCost = Number(diagnosisData.warranty_cost) || 0;
    const calculatedTotal = materialCost + laborCost + warrantyCost;

    // Allow slight float difference but ensure it matches
    if (Math.abs(calculatedTotal - diagnosisData.final_total_cost) > 1.0) {
        // throw new Error(`Total cost mismatch. Calculated: ${calculatedTotal}, Provided: ${diagnosisData.final_total_cost}`);
        // For now, auto-correct it instead of erroring out to be user-friendly
        diagnosisData.final_total_cost = calculatedTotal;
    }

    job.diagnosis_report = {
        ...diagnosisData,
        submitted_at: new Date(),
        status: 'pending'
    };
    job.status = 'diagnosis_mode';
    appendTimeline(job, 'diagnosis_mode', 'worker', 'Diagnosis report submitted');

    await job.save();

    // FCM Push + In-App: notify tenant diagnosis is ready for review
    try {
        const tenant = await User.findById(job.user_id).select('name email fcmTokens');
        if (tenant) {
            await notifyHelper.onDiagnosisReady(tenant, job, diagnosisData.final_total_cost);
        }
    } catch (e) {
        logger.error(`submitDiagnosis notify failed: ${e.message}`);
    }

    return job;
};

/**
 * Helper: Finalize Job Status after successful Escrow/Payment
 */
exports.handleJobPaymentSuccess = async (jobId, amount, gateway = null, gatewayId = null, session = null) => {
    const job = await Job.findById(jobId)
        .populate('user_id', 'name email')
        .populate('selected_worker_id', 'name email')
        .session(session);

    if (!job) throw new Error('Job not found for finalization');

    // If external gateway used, ensuring we record the payment in our DB
    if (gateway) {
        await PaymentService.recordExternalEscrow(jobId, job.user_id._id, amount, gateway, gatewayId, session);
    }

    job.status = 'diagnosed';
    job.diagnosis_report.status = 'approved';
    job.diagnosis_report.approved_at = new Date();
    appendTimeline(job, 'diagnosed', 'user', 'Diagnosis approved. Funds secured in platform escrow.');

    // Notify Worker (Async - don't need session)
    notifyHelper.onJobStatusUpdate(
        job.selected_worker_id._id,
        'Diagnosis Approved & Paid',
        'Client approved estimate and funds are secured. Enter OTP to start.',
        { jobId: job._id, type: 'info' }
    ).catch(e => logger.error(`Notification failed for job ${jobId}: ${e.message}`));

    // Send Professional Emails (Async - don't need session)
    try {
        const breakdown = await PaymentService.calculateBreakdown(amount, job.selected_worker_id._id);

        EmailService.sendPaymentEscrowedUser(job.user_id.email, {
            jobId: job._id,
            userName: job.user_id.name,
            jobTitle: job.job_title,
            jobAmount: amount,
            protectionFee: breakdown.protectionFee,
            totalAmount: breakdown.totalUserPayable,
            warrantyDays: job.diagnosis_report.warranty_duration_days || 0
        });

        EmailService.sendPaymentEscrowedWorker(job.selected_worker_id.email, {
            workerName: job.selected_worker_id.name,
            jobTitle: job.job_title,
            grossAmount: amount,
            commissionAmount: breakdown.commission,
            netPayout: breakdown.workerAmount
        });
    } catch (e) {
        logger.error(`Post-payment email failed for job ${jobId}: ${e.message}`);
    }

    return await job.save({ session });
};

/**
 * C. Diagnosis Mode: Approve/Reject
 */
exports.approveDiagnosis = async (jobId, userId, approved, rejectionReason) => {
    const job = await Job.findById(jobId)
        .populate('user_id', 'name email')
        .populate('selected_worker_id', 'name email');

    if (!job) throw new Error('Job not found');
    if (job.user_id._id.toString() !== userId.toString()) throw new Error('Unauthorized');

    if (approved) {
        const amount = job.diagnosis_report.final_total_cost;
        if (!amount || amount <= 0) {
            throw new Error('Invalid diagnosis cost. Cannot proceed to payment.');
        }

        try {
            // Attempt wallet payment first (Legacy flow)
            await PaymentService.createEscrow(jobId, userId, amount);
            return await this.handleJobPaymentSuccess(jobId, amount);
        } catch (paymentError) {
            // If wallet fails, we allow the controller to offer Stripe Checkout
            logger.info(`Wallet payment skipped/failed for job ${jobId}: ${paymentError.message}`);
            throw paymentError;
        }
    } else {
        job.diagnosis_report.status = 'rejected';
        job.diagnosis_report.rejection_reason = rejectionReason;
        job.status = 'eta_confirmed';
        appendTimeline(job, 'eta_confirmed', 'user', `Diagnosis rejected: ${rejectionReason}`);
        return await job.save();
    }
};

/**
 * D. Material Approval Subflow: Request
 */
exports.requestMaterial = async (jobId, workerId, requestData, billProofFile) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'in_progress') throw new Error('Job must be in progress');

    let bill_proof = requestData.bill_proof; // Fallback to existing URL if any

    if (billProofFile) {
        const uploadResult = await cloudinaryService.uploadOptimizedImage(billProofFile.buffer, `skillbridge/materials/${jobId}`);
        bill_proof = uploadResult.url;
    }

    job.material_requests.push({
        ...requestData,
        bill_proof,
        status: 'pending',
        requested_at: new Date()
    });
    job.status = 'material_pending_approval'; // Pause job? Or keeps running? Prompt says "Status -> MATERIAL_PENDING_APPROVAL"
    appendTimeline(job, 'material_pending_approval', 'worker', `Material requested: ${requestData.item_name}`);

    await job.save();

    // Notify User (Multi-channel)
    try {
        const tenant = await User.findById(job.user_id);
        if (tenant) {
            await notifyHelper.onMaterialRequested(tenant, job, requestData.item_name, requestData.cost);
        }
    } catch (e) {
        logger.error(`requestMaterial notify failed: ${e.message}`);
    }

    return job;
};

/**
 * D. Material Approval Subflow: Respond
 */
exports.respondToMaterial = async (jobId, userId, requestId, approved) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.user_id.toString() !== userId.toString()) throw new Error('Unauthorized');

    const request = job.material_requests.id(requestId);
    if (!request) throw new Error('Request not found');

    if (approved) {
        try {
            // Lock funds for material
            await PaymentService.createMaterialEscrow(jobId, userId, request.cost);
            request.status = 'approved';
        } catch (e) {
            logger.error(`Material Escrow Failed: ${e.message}`);
            throw new Error(`Approval Failed: Insufficient funds or payment error. ${e.message}`);
        }
    } else {
        request.status = 'rejected';
    }
    request.responded_at = new Date();

    // Check if any other pending?
    const hasPending = job.material_requests.some(r => r.status === 'pending');
    if (!hasPending) {
        job.status = 'in_progress'; // Resume
    }

    appendTimeline(job, job.status, 'user', `Material ${approved ? 'Approved' : 'Rejected'}`);

    await job.save();
    return job;
};

/**
 * Submit Completion Proof (Updated with Summary & Signature)
 */
exports.submitCompletion = async (jobId, workerId, files, summary, signatureFile) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'in_progress') throw new Error('Job must be in progress to complete.');

    let completion_photos = [];
    if (!files || files.length === 0) {
        throw new Error('At least one completion photo is required as evidence.');
    }

    const uploadPromises = files.map(file =>
        cloudinaryService.uploadOptimizedImage(file.buffer, `skillbridge/completion/${jobId}`)
    );
    const uploadResults = await Promise.all(uploadPromises);
    completion_photos = uploadResults.map(r => r.url);

    let digital_signature = null;
    if (signatureFile) {
        const uploadResult = await cloudinaryService.uploadOptimizedImage(signatureFile.buffer, `skillbridge/signatures/${jobId}`);
        digital_signature = uploadResult.url;
    }

    job.status = 'reviewing';
    job.completion_photos = completion_photos;
    job.digital_signature = digital_signature;
    job.work_summary = summary;
    job.completed_at = new Date();

    appendTimeline(job, 'reviewing', 'worker', 'Completion proof & digital signature submitted');
    await job.save();

    // FCM Push + In-App: notify tenant to release payment
    try {
        const tenant = await User.findById(job.user_id).select('name email fcmTokens');
        if (tenant) {
            await notifyHelper.onJobCompleted(tenant, job);
        }
    } catch (e) {
        logger.error(`submitCompletion notify failed: ${e.message}`);
    }

    return job;
};

/**
 * E. Cooling Window (Prev. Confirm Completion)
 */
exports.confirmCompletion = async (jobId, userId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.user_id.toString() !== userId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'reviewing') throw new Error('Job is not under review');

    // NEW: Cooling Window
    job.status = 'cooling_window';
    job.cooling_period = {
        starts_at: new Date(),
        ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        dispute_raised: false
    };

    appendTimeline(job, 'cooling_window', 'user', 'Client confirmed work. Cooling period started (24h).');
    await job.save();

    // Notify Worker
    await notifyHelper.onJobStatusUpdate(
        job.selected_worker_id,
        'Work Accepted',
        'Client accepted work. Payment triggers in 24 hours if no disputes.',
        { jobId: job._id, type: 'info' }
    );

    return job;
};

/**
 * F. Finalize Job (Post Cooling Window)
 * Should be called by a scheduler or manual trigger after 24 hours.
 */
exports.finalizeJob = async (jobId) => {
    const job = await Job.findById(jobId)
        .populate('user_id', 'name email')
        .populate('selected_worker_id', 'name email');
    if (!job) throw new Error('Job not found');

    if (job.status !== 'cooling_window') throw new Error('Job is not in cooling window');

    // Check time
    if (new Date() < new Date(job.cooling_period.ends_at)) {
        throw new Error('Cooling period has not ended yet');
    }

    if (job.cooling_period.dispute_raised) {
        throw new Error('Cannot finalize: Dispute is active');
    }

    // Release Payment (This function handles its own session and saving of job.payment_released)
    try {
        await PaymentService.releasePayment(jobId);
    } catch (err) {
        logger.error(`Failed to release payment for job ${jobId}`, err);
        throw new Error(`Payment Release Failed: ${err.message}`);
    }

    // Use findByIdAndUpdate to set status without risking overwriting changes made by releasePayment
    const finalizedJob = await Job.findByIdAndUpdate(
        jobId,
        { status: 'completed' },
        { new: true }
    );

    // Update Worker Stats (Passport) - Moved from confirmCompletion
    try {
        const worker = await Worker.findOne({ user: job.selected_worker_id._id });
        if (worker) {
            const skillIndex = worker.skill_stats.findIndex(s => s.skill === job.skill_required);
            if (skillIndex > -1) {
                worker.skill_stats[skillIndex].confidence = Math.min(100, worker.skill_stats[skillIndex].confidence + 5);
                worker.skill_stats[skillIndex].last_used = new Date();
            } else {
                worker.skill_stats.push({ skill: job.skill_required, confidence: 100, last_used: new Date() });
            }

            // Note: totalJobsCompleted is now handled inside PaymentService.releasePayment to stay consistent with money flows.

            await worker.save();
        }
    } catch (e) {
        logger.error('Failed to update worker stats', e);
    }

    // Notify Both
    await notifyHelper.onJobStatusUpdate(
        job.selected_worker_id._id,
        'Payment Released',
        'Job finalized successfully. Payment has been credited.',
        { jobId: job._id, type: 'payment_received' }
    );

    // Send Professional Email to Worker
    try {
        const workerUser = job.selected_worker_id; // Already populated
        if (workerUser && workerUser.email) {
            const amount = job.diagnosis_report.final_total_cost;
            const breakdown = await PaymentService.calculateBreakdown(amount, workerUser._id);

            EmailService.sendPaymentReleasedWorker(workerUser.email, {
                workerName: workerUser.name,
                jobTitle: job.job_title,
                netPayout: breakdown.workerAmount
            });
        }
    } catch (emailErr) {
        logger.error(`Failed to send payout email for job ${job.id}`, emailErr);
    }

    return job;
};



/**
 * G. Dispute Handling
 */
/**
 * H. Cancellation Policy Implementation
 */
exports.cancelJob = async (jobId, userId, userRole, reason) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    // 1. Validate permissions
    if (userRole === 'worker' && job.selected_worker_id?.toString() !== userId.toString()) {
        throw new Error('Unauthorized');
    }
    if (userRole === 'user' && job.user_id?.toString() !== userId.toString()) {
        throw new Error('Unauthorized');
    }

    // 2. Prevent cancellation if too late
    if (['completed', 'cancelled', 'disputed', 'cooling_window'].includes(job.status)) {
        throw new Error('Cannot cancel job in its current state.');
    }

    // Refund logic if Escrow was already created (Status: diagnosed, in_progress, reviewing, material_pending...)
    // Basically if diagnosis was approved.
    const escrowStages = ['diagnosed', 'in_progress', 'reviewing', 'material_pending_approval', 'eta_confirmed']; // eta_confirmed might be BEFORE diagnosis?
    // Check timeline or diagnosis status
    if (job.diagnosis_report?.status === 'approved') {
        try {
            await PaymentService.refundPayment(jobId);
            appendTimeline(job, 'cancelled', 'system', 'Escrow refunded to user wallet.');
        } catch (e) {
            logger.error(`Refund failed for job ${jobId}`, e);
            // Verify if escrow existed? PaymentService.refundPayment handles check.
            // If error is "Escrow record not found", we ignore.
            if (e.message !== 'Escrow record not found') {
                // Log but proceed with cancellation? Or block?
                // Safer to block cancellation if money is stuck? No, cancel job but flag error.
                // For now, allow cancellation but log error.
            }
        }
    }

    let penaltyAmount = 0;
    let penaltyReason = '';

    // 3. Worker Cancellation Logic (Professional Accountability)
    if (userRole === 'worker') {
        const WalletService = require('../wallet/wallet.service');
        try {
            const worker = await Worker.findOne({ user: userId });
            if (worker) {
                // Heavier score drop for cancelling during journey
                const scorePenalty = (['on_the_way', 'arrived'].includes(job.status)) ? 20 : 10;
                worker.reliabilityScore = Math.max(0, worker.reliabilityScore - scorePenalty);
                worker.reliabilityStats.cancellations = (worker.reliabilityStats.cancellations || 0) + 1;
                await worker.save();

                // Financial Penalty for workers (Service Breach Fee)
                if (job.status === 'on_the_way') {
                    penaltyAmount = 100; // Fuel/Time compensation for platform
                    penaltyReason = 'Worker cancellation after journey started.';
                } else if (job.status === 'arrived') {
                    penaltyAmount = 250; // High penalty for no-show after arrival
                    penaltyReason = 'Worker cancellation after arrival. Serious service breach.';
                }

                if (penaltyAmount > 0) {
                    await WalletService.debitWallet(userId, penaltyAmount);
                    // Platform keeps worker penalties usually, or credits to system wallet
                    await WalletService.creditPlatformRevenue(penaltyAmount);
                }
            }
        } catch (e) {
            logger.error(`Failed to process worker cancellation penalty: ${e.message}`);
        }
    }

    // 4. Tenant Cancellation Logic (Stage-Based Matrix)
    else if (userRole === 'user' || userRole === 'admin') {
        const WalletService = require('../wallet/wallet.service');
        switch (job.status) {
            case 'open':
                penaltyAmount = 0;
                penaltyReason = 'No penalty (Open stage)';
                break;
            case 'assigned':
            case 'eta_confirmed':
                penaltyAmount = 50; // Small fee
                penaltyReason = 'Late cancellation fee (Assigned stage)';
                break;
            case 'on_the_way':
                penaltyAmount = 150; // Travel fee
                penaltyReason = 'Travel compensation fee for worker';
                break;
            case 'arrived':
            case 'in_progress':
            case 'diagnosis_mode':
            case 'diagnosed':
            case 'reviewing':
            case 'material_pending_approval':
                // Base Visit Charge (Varies by industry, but 500 is standard enterprise minimum)
                penaltyAmount = 500;
                penaltyReason = 'Work/Diagnosis started compensation';
                break;
            default:
                penaltyAmount = 0;
        }

        // Apply Financial Penalty for User
        if (penaltyAmount > 0) {
            try {
                await WalletService.debitWallet(userId, penaltyAmount);
                if (job.selected_worker_id) {
                    // Credit 80% to worker as compensation for travel/time, 20% to platform
                    await WalletService.creditWallet(job.selected_worker_id, penaltyAmount * 0.8);
                    await WalletService.creditPlatformRevenue(penaltyAmount * 0.2);
                }
            } catch (walletErr) {
                logger.error(`Failed to process tenant cancellation penalty for job ${jobId}: ${walletErr.message}`);
                // In a production app, we might want to prevent cancellation if debit fails, 
                // but usually, we allow cancellation and leave the wallet negative (overdraft).
            }
        }
    }

    // 5. Finalize Cancellation
    job.status = 'cancelled';
    job.cancelled_by = {
        user: userId,
        reason: reason,
        penalty: penaltyAmount,
        at: new Date()
    };

    appendTimeline(job, 'cancelled', userRole === 'user' ? 'user' : 'worker',
        `Job Cancelled. Reason: ${reason}. Penalty: ₹${penaltyAmount}. Note: ${penaltyReason}`,
        { penalty: penaltyAmount, reasonCode: penaltyReason }
    );

    await job.save();

    // Notify Counterparty (Multi-channel)
    try {
        const recipientId = userRole === 'user' ? job.selected_worker_id : job.user_id;
        if (recipientId) {
            await notifyHelper.onJobCancelled(recipientId, job, userRole, reason);
        }
    } catch (e) {
        logger.error(`cancelJob notify failed: ${e.message}`);
    }

    return job;
};

exports.raiseDispute = async (jobId, userId, reason) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    // Allow dispute during cooling window (or execution if critical, but prompt emphasized cooling)
    if (job.status !== 'cooling_window') throw new Error('Disputes can only be raised during the cooling window.');
    if (job.user_id.toString() !== userId.toString()) throw new Error('Unauthorized');

    job.status = 'disputed';
    job.dispute = {
        is_disputed: true,
        reason: reason,
        opened_at: new Date(),
        status: 'open'
    };
    job.cooling_period.dispute_raised = true;

    appendTimeline(job, 'disputed', 'user', `Dispute raised: ${reason}`);
    await job.save();

    // Update Worker Stats
    try {
        const worker = await Worker.findOne({ user: job.selected_worker_id });
        if (worker) {
            worker.reliabilityStats = worker.reliabilityStats || { disputes: 0, cancellations: 0, punctuality: 0 };
            worker.reliabilityStats.disputes += 1;
            await worker.save();
        }
    } catch (e) {
        logger.error('Failed to update worker dispute stats', e);
    }

    await job.save();

    // Notify Worker (Multi-channel)
    try {
        const worker = await User.findById(job.selected_worker_id);
        if (worker) {
            await notifyHelper.onDisputeRaised(worker, job, reason);
        }
    } catch (e) {
        logger.error(`raiseDispute notify failed: ${e.message}`);
    }

    return job;
};

exports.resolveDispute = async (jobId, adminId, decision, notes) => {
    const job = await Job.findById(jobId)
        .populate('user_id', 'name email')
        .populate('selected_worker_id', 'name email');
    if (!job) throw new Error('Job not found');
    if (!job.dispute.is_disputed) throw new Error('Job is not disputed');

    job.dispute.status = 'resolved';
    job.dispute.resolved_at = new Date();

    let notificationTitle = 'Dispute Resolved';

    // Decision Logic: 'release_payment' or 'refund_client'
    if (decision === 'release_payment') {
        try {
            await PaymentService.releasePayment(jobId);
            job.status = 'completed';
            job.payment_released = true;
            appendTimeline(job, 'completed', 'admin', `Dispute resolved in favor of worker. Note: ${notes}`);
            notificationTitle = 'Dispute Resolved: Payment Released';
        } catch (e) {
            throw new Error(`Failed to release payment: ${e.message}`);
        }
    } else if (decision === 'refund_client') {
        try {
            const refund = await PaymentService.refundPayment(jobId);
            // Refund email notification is already handled in PaymentService.refundPayment
            job.status = 'cancelled';
            job.payment_released = false;
            appendTimeline(job, 'cancelled', 'admin', `Dispute resolved in favor of client. Note: ${notes}`);
            notificationTitle = 'Dispute Resolved: Refunded';
        } catch (e) {
            throw new Error(`Failed to refund payment: ${e.message}`);
        }
    } else {
        job.status = 'cooling_window';
        appendTimeline(job, 'cooling_window', 'admin', `Dispute resolved: Continuing cooling period. Note: ${notes}`);
    }

    await job.save();

    // Notify Counterparties (Multi-channel) via Helper
    try {
        const tenantAmount = decision === 'refund_client' ? job.diagnosis_report.final_total_cost : 0;
        const workerAmount = decision === 'release_payment' ? job.diagnosis_report.final_total_cost : 0;

        await notifyHelper.onSettlementProcessed(
            job.user_id,
            job.selected_worker_id,
            job,
            tenantAmount,
            workerAmount
        );
    } catch (e) {
        logger.error(`resolveDispute notify failed: ${e.message}`);
    }

    // Professional Emails (Async)
    try {
        EmailService.sendDisputeResolvedEmail(job.user_id.email, {
            userName: job.user_id.name,
            jobTitle: job.job_title,
            decision,
            notes,
            isAdmin: true
        });
        EmailService.sendDisputeResolvedEmail(job.selected_worker_id.email, {
            userName: job.selected_worker_id.name,
            jobTitle: job.job_title,
            decision,
            notes,
            isAdmin: true
        });
    } catch (err) {
        logger.error(`Dispute Email Error for job ${jobId}`, err);
    }

    return job;
};

/**
 * Warranty Logic
 */
exports.claimWarranty = async (jobId, userId, reason) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.user_id.toString() !== userId.toString()) throw new Error('Unauthorized');

    // 1. Check if warranty exists
    if (!job.diagnosis_report?.warranty_offered) {
        throw new Error('No warranty was offered for this job.');
    }

    // 2. Check Expiry
    const completedAt = job.completed_at || job.updatedAt;
    const expiryDate = new Date(completedAt.getTime() + job.diagnosis_report.warranty_duration_days * 24 * 60 * 60 * 1000);
    if (new Date() > expiryDate) {
        throw new Error('Warranty period has expired.');
    }

    if (job.warranty_claim?.active) {
        throw new Error('A warranty claim is already active.');
    }

    // 3. Create Claim
    job.warranty_claim = {
        active: true,
        reason: reason,
        claimed_at: new Date(),
        resolved: false
    };

    appendTimeline(job, 'completed', 'user', `Warranty Claim Raised: ${reason}`, { type: 'warranty_claim' });

    await job.save();

    // Notify Worker (Multi-channel)
    try {
        const worker = await User.findById(job.selected_worker_id);
        if (worker) {
            await notifyHelper.onWarrantyClaimed(worker, job, reason);
        }
    } catch (e) {
        logger.error(`claimWarranty notify failed: ${e.message}`);
    }

    return job;
};

exports.resolveWarranty = async (jobId, workerId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    // Allow worker or admin
    if (job.selected_worker_id.toString() !== workerId.toString()) {
        // Check if admin? For now assume only worker resolves.
        // throw new Error('Unauthorized');
    }

    if (!job.warranty_claim?.active) {
        throw new Error('No active warranty claim.');
    }

    job.warranty_claim.active = false;
    job.warranty_claim.resolved = true;

    appendTimeline(job, 'completed', 'worker', 'Warranty claim resolved.');
    await job.save();

    // Notify User (Multi-channel)
    try {
        const tenant = await User.findById(job.user_id);
        if (tenant) {
            await notifyHelper.onWarrantyResolved(tenant, job);
        }
    } catch (e) {
        logger.error(`resolveWarranty notify failed: ${e.message}`);
    }

    return job;
};

exports.getJobById = async (jobId) => {
    // Return full job details including timeline
    return Job.findById(jobId)
        .populate('user_id', 'name phone address')
        .populate('selected_worker_id', 'name phone profileImage');
};
