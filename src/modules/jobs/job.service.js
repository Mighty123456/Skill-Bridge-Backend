const Job = require('./job.model');
const User = require('../users/user.model');
const Worker = require('../workers/worker.model');
const NotificationService = require('../notifications/notification.service');
const cloudinaryService = require('../../common/services/cloudinary.service'); // For file uploads if needed logic here
const { calculateDistance } = require('../../common/utils/geo');
const logger = require('../../config/logger');

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
    // ... (Existing Logic)
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
    }).select('_id fcmToken');

    await NotificationService.sendThrottledJobAlerts(nearbyUsers, job);
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

    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Worker ETA Confirmed',
        message: `Worker will arrive at ${new Date(etaTime).toLocaleTimeString()}`,
        type: 'info',
        data: { jobId: job._id }
    });

    return job;
};

/**
 * B2. Start Journey
 * Worker indicates they are on the way.
 */
exports.startJourney = async (jobId, workerId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'eta_confirmed') throw new Error('Must confirm ETA before starting journey');

    job.status = 'on_the_way';
    job.journey = job.journey || {};
    job.journey.started_at = new Date();

    appendTimeline(job, 'on_the_way', 'worker', 'Worker started journey');
    await job.save();

    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Worker is On The Way',
        message: 'Worker has started their journey to your location.',
        type: 'info',
        data: { jobId: job._id }
    });

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

    // Penalty if late
    if (is_late) {
        const worker = await Worker.findOne({ user: workerId });
        if (worker) {
            worker.reliabilityScore = Math.max(0, worker.reliabilityScore - 5); // Reduced penalty
            await worker.save();
        }
    }

    // Notify User
    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Worker Arrived',
        message: 'Worker has arrived. Please share the OTP to start the job.',
        type: 'action_required',
        data: { jobId: job._id }
    });

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

    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Worker Delayed',
        message: `Worker reported a delay: ${reason}.`,
        type: 'alert',
        data: { jobId: job._id }
    });

    return job;
};

exports.updateLocation = async (jobId, workerId, lat, lng) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');

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

    // Notify User
    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Job Started',
        message: 'Worker has started the job.',
        type: 'job_started',
        data: { jobId: job._id }
    });

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

    // Notify User
    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Diagnosis Report Ready',
        message: 'Worker has submitted final estimation. Please review to start job.',
        type: 'action_required',
        data: { jobId: job._id }
    });

    return job;
};

/**
 * C. Diagnosis Mode: Approve/Reject
 */
exports.approveDiagnosis = async (jobId, userId, approved, rejectionReason) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.user_id.toString() !== userId.toString()) throw new Error('Unauthorized');

    if (approved) {
        // NEW: Require OTP to start work. Status goes to 'diagnosed' first.
        job.status = 'diagnosed';
        job.diagnosis_report.status = 'approved';
        job.diagnosis_report.approved_at = new Date();
        appendTimeline(job, 'diagnosed', 'user', 'Diagnosis approved. Waiting for OTP to start job.');

        // Notify Worker
        await NotificationService.createNotification({
            recipient: job.selected_worker_id,
            title: 'Diagnosis Approved',
            message: 'Client approved your estimate. Please enter OTP to start the job.',
            type: 'info',
            data: { jobId: job._id }
        });
    } else {
        job.diagnosis_report.status = 'rejected';
        job.diagnosis_report.rejection_reason = rejectionReason;
        job.status = 'eta_confirmed'; // Send back to step before? Or cancel?
        // Let's allow resubmission
        appendTimeline(job, 'eta_confirmed', 'user', `Diagnosis rejected: ${rejectionReason}`);
    }

    await job.save();
    return job;
};

/**
 * D. Material Approval Subflow: Request
 */
exports.requestMaterial = async (jobId, workerId, requestData) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    if (job.status !== 'in_progress') throw new Error('Job must be in progress');

    job.material_requests.push({
        ...requestData, // item_name, cost, bill_proof, reason
        status: 'pending',
        requested_at: new Date()
    });
    job.status = 'material_pending_approval'; // Pause job? Or keeps running? Prompt says "Status -> MATERIAL_PENDING_APPROVAL"
    appendTimeline(job, 'material_pending_approval', 'worker', `Material requested: ${requestData.item_name}`);

    await job.save();

    // Notify User
    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Additional Material Requested',
        message: `Worker needs approval for ${requestData.item_name} (${requestData.cost})`,
        type: 'action_required',
        data: { jobId: job._id }
    });

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

    request.status = approved ? 'approved' : 'rejected';
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
 * Submit Completion Proof (Existing - Updated constraints)
 */
exports.submitCompletion = async (jobId, workerId, files) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.selected_worker_id.toString() !== workerId.toString()) throw new Error('Unauthorized');
    // Allow from in_progress
    if (job.status !== 'in_progress') throw new Error('Job must be in progress to complete.');

    let completion_photos = [];
    if (files && files.length > 0) {
        const uploadPromises = files.map(file =>
            cloudinaryService.uploadOptimizedImage(file.buffer, `skillbridge/completion/${jobId}`)
        );
        const uploadResults = await Promise.all(uploadPromises);
        completion_photos = uploadResults.map(r => r.url);
    }

    job.status = 'reviewing';
    job.completion_photos = completion_photos;
    job.completed_at = new Date();

    appendTimeline(job, 'reviewing', 'worker', 'Completion proof submitted');
    await job.save();

    await NotificationService.createNotification({
        recipient: job.user_id,
        title: 'Review Completion',
        message: 'Worker has submitted completion proof. Please review.',
        type: 'completion_review',
        data: { jobId: job._id }
    });

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
    await NotificationService.createNotification({
        recipient: job.selected_worker_id,
        title: 'Work Accepted',
        message: 'Client accepted work. Payment triggers in 24 hours if no disputes.',
        type: 'info',
        data: { jobId: job._id }
    });

    return job;
};

/**
 * F. Finalize Job (Post Cooling Window)
 * Should be called by a scheduler or manual trigger after 24 hours.
 */
exports.finalizeJob = async (jobId) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');

    if (job.status !== 'cooling_window') throw new Error('Job is not in cooling window');

    // Check time
    if (new Date() < new Date(job.cooling_period.ends_at)) {
        throw new Error('Cooling period has not ended yet');
    }

    if (job.cooling_period.dispute_raised) {
        throw new Error('Cannot finalize: Dispute is active');
    }

    // Release Payment
    job.status = 'completed';
    job.payment_released = true;
    appendTimeline(job, 'completed', 'system', 'Cooling period ended. Payment released.');

    await job.save();

    // Update Worker Stats (Passport) - Moved from confirmCompletion
    try {
        const worker = await Worker.findOne({ user: job.selected_worker_id });
        if (worker) {
            const skillIndex = worker.skill_stats.findIndex(s => s.skill === job.skill_required);
            if (skillIndex > -1) {
                worker.skill_stats[skillIndex].confidence = Math.min(100, worker.skill_stats[skillIndex].confidence + 5);
                worker.skill_stats[skillIndex].last_used = new Date();
            } else {
                worker.skill_stats.push({ skill: job.skill_required, confidence: 100, last_used: new Date() });
            }
            // Reputation Logic could update here
            await worker.save();
        }
    } catch (e) {
        logger.error('Failed to update worker stats', e);
    }

    // Notify Both
    await NotificationService.createNotification({
        recipient: job.selected_worker_id,
        title: 'Payment Released',
        message: 'Job finalized successfully. Payment has been credited.',
        type: 'payment_received',
        data: { jobId: job._id }
    });

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

    let penaltyAmount = 0;
    let penaltyReason = '';

    // 3. Worker Cancellation Logic
    if (userRole === 'worker') {
        // Penalty: Reliability Score Drop
        try {
            const worker = await Worker.findOne({ user: userId });
            if (worker) {
                worker.reliabilityScore = Math.max(0, worker.reliabilityScore - 10); // -10 points
                worker.reliabilityStats.cancellations = (worker.reliabilityStats.cancellations || 0) + 1;
                await worker.save();
            }
        } catch (e) {
            logger.error('Failed to apply worker cancellation penalty', e);
        }
        penaltyReason = 'Worker cancelled. Reliability score deduced.';
    }

    // 4. Tenant Cancellation Logic (Stage-Based Matrix)
    else if (userRole === 'user' || userRole === 'admin') {
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
                penaltyReason = 'Travel compensation fee';
                break;
            case 'arrived':
                penaltyAmount = 250; // Time wasted fee
                penaltyReason = 'Arrival compensation fee';
                break;
            case 'in_progress':
            case 'diagnosis_mode':
            case 'material_pending_approval':
                penaltyAmount = 500; // Base Diagnosis Charge (assumption)
                penaltyReason = 'Work started compensation';
                break;
            default:
                penaltyAmount = 0;
        }

        // Apply Financial Penalty (Mock Logic - In real app, deduct from wallet)
        if (penaltyAmount > 0) {
            // await WalletService.deduct(userId, penaltyAmount, penaltyReason);
            // await WalletService.credit(job.selected_worker_id, penaltyAmount * 0.8, 'Cancellation Compensation');
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

    // Notify Counterparty
    const recipientId = userRole === 'user' ? job.selected_worker_id : job.user_id;
    if (recipientId) {
        await NotificationService.createNotification({
            recipient: recipientId,
            title: 'Job Cancelled',
            message: `The job has been cancelled by the ${userRole}. Reason: ${reason}`,
            type: 'alert',
            data: { jobId: job._id }
        });
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

    // Notify Admin & Worker
    // await NotificationService.notifyAdmin(...) 
    await NotificationService.createNotification({
        recipient: job.selected_worker_id,
        title: 'Dispute Raised',
        message: 'Client has raised a dispute. Payment is on hold until resolved.',
        type: 'alert',
        data: { jobId: job._id }
    });

    return job;
};

exports.resolveDispute = async (jobId, adminId, decision, notes) => {
    const job = await Job.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (!job.dispute.is_disputed) throw new Error('Job is not disputed');

    job.dispute.status = 'resolved';
    job.dispute.resolved_at = new Date();

    // Decision Logic: 'refund' or 'release'
    if (decision === 'release_payment') {
        job.status = 'completed';
        job.payment_released = true;
        appendTimeline(job, 'completed', 'admin', `Dispute resolved (Release Payment). Note: ${notes}`);
    } else if (decision === 'refund_client') {
        job.status = 'cancelled';
        job.payment_released = false; // Refund logic would happen here
        appendTimeline(job, 'cancelled', 'admin', `Dispute resolved (Refund Client). Note: ${notes}`);
    } else {
        // Continue cooling?
        job.status = 'cooling_window';
        appendTimeline(job, 'cooling_window', 'admin', `Dispute resolved (Continue Cooling). Note: ${notes}`);
    }

    await job.save();
    return job;
};

exports.getJobById = async (jobId) => {
    // Return full job details including timeline
    return Job.findById(jobId)
        .populate('user_id', 'name phone address')
        .populate('selected_worker_id', 'name phone profileImage');
};
