const Contract = require('./contract.model');
const logger = require('../../config/logger');
const notifyHelper = require('../../common/notification.helper');

/**
 * Create a new contract (Contractor only)
 * @route   POST /api/v1/contracts
 * @access  Private (Contractor)
 */
exports.createContract = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { 
            workerId: rawWorkerId, 
            title, 
            description, 
            agreementType, 
            totalValue, 
            monthlyRate, 
            paymentFrequency,
            startDate,
            endDate,
            termsAndConditions,
            projectId,
            currency,
            autoRenew,
            terminationNoticePeriodDays
        } = req.body;

        // Resolve Worker ID (could be User ID or Worker Profile ID)
        const User = require('../users/user.model');
        const Worker = require('../workers/worker.model');
        let workerUser = await User.findById(rawWorkerId);
        let workerProfile;

        if (workerUser) {
            workerProfile = await Worker.findOne({ user: workerUser._id });
        } else {
            workerProfile = await Worker.findById(rawWorkerId).populate('user');
            if (workerProfile) {
                workerUser = workerProfile.user;
            }
        }

        if (!workerUser) {
            return res.status(404).json({ success: false, message: 'Professional not found' });
        }

        const workerId = workerUser._id;

        // Rule 4.4: One contract per worker
        const existing = await Contract.findOne({
            contractor_id: contractorId,
            worker_id: workerId,
            status: { $in: ['pending', 'active'] }
        });
        if (existing) {
            return res.status(400).json({ 
                success: false, 
                message: 'A pending or active contract already exists for this professional. Terminate the current one before proposing another.' 
            });
        }

        // Rule 4.5: Payment must be backed by wallet balance
        const Wallet = require('../wallet/wallet.model');
        const wallet = await Wallet.findOne({ user: contractorId });
        const costToReserve = agreementType === 'fixed' ? Number(totalValue) : Number(monthlyRate);

        if (!wallet || wallet.balance < costToReserve) {
            return res.status(402).json({ 
                success: false, 
                message: `Insufficient wallet balance to back this contract commitment. Required: ₹${costToReserve}. Your balance: ₹${wallet ? wallet.balance : 0}. Please top up your wallet.` 
            });
        }

        // Rule 4.4: Conflict detection for proposed dates
        const { isWorkerAvailable } = require('../workers/worker.controller');
        const available = await isWorkerAvailable(workerId, startDate, endDate);
        if (!available) {
            return res.status(403).json({ 
                success: false, 
                message: 'Scheduling conflict detected: This professional is already committed to other tasks during your proposed contract dates.' 
            });
        }

        // Use a transaction for atomic Contract Creation + Escrow Locking
        const mongoose = require('mongoose');
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // Create the contract
            const contract = new Contract({
                contractor_id: contractorId,
                worker_id: workerId,
                title,
                description,
                agreement_type: agreementType,
                total_value: totalValue,
                monthly_rate: monthlyRate,
                currency: currency || 'INR',
                payment_frequency: paymentFrequency,
                start_date: startDate,
                end_date: endDate,
                terms_and_conditions: termsAndConditions,
                auto_renew: autoRenew,
                termination_notice_period_days: terminationNoticePeriodDays,
                status: 'pending',
                timeline: [{
                    status: 'pending',
                    timestamp: new Date(),
                    note: 'Contract offer initiated. Funds secured in escrow.',
                    actor: 'contractor'
                }],
                project_id: projectId
            });

            await contract.save({ session });
            
            // Link worker to project if projectId is provided
            if (projectId) {
                const Job = require('../jobs/job.model');
                await Job.findByIdAndUpdate(
                    projectId,
                    { $addToSet: { worker_ids: workerId } },
                    { session }
                );
            }

            // Rule 6.3: Contract created → funds locked (escrow)
            const WalletService = require('../wallet/wallet.service');
            await WalletService.lockEscrow(
                contractorId, 
                null, // Project ID is null for generic contracts or use contract._id
                workerId, 
                costToReserve, 
                `Escrow for contract: ${title}`
            );

            await session.commitTransaction();
            
            // Notify worker
            notifyHelper.onContractReceived(workerId, title, req.user.name).catch((err) => {
                logger.warn(`[Contract] Notification failed for worker ${workerId}: ${err.message}`);
            });

            res.status(201).json({
                success: true,
                message: 'Contract proposal sent and funds secured in escrow.',
                data: contract
            });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        logger.error('Create Contract Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create contract proposal',
        });
    }
};


/**
 * Respond to a contract (Worker only)
 * @route   PATCH /api/v1/contracts/:id/respond
 * @access  Private (Worker)
 */
exports.respondToContract = async (req, res) => {
    const { id } = req.params;
    const { status, note, signature } = req.body;
    const userId = req.user._id;

    logger.info(`[ContractController] respondToContract: User ${userId} responding ${status} to contract ${id}`);

    if (!['active', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid response status' });
    }

    try {
        const Worker = require('../workers/worker.model');
        const workerProfile = await Worker.findOne({ user: userId });

        // Find contract checking both direct User ID and Worker Profile ID (just in case)
        const contract = await Contract.findOne({ 
            _id: id, 
            $or: [
                { worker_id: userId },
                { worker_id: workerProfile ? workerProfile._id : null }
            ]
        });

        if (!contract) {
            logger.warn(`[ContractController] Contract ${id} not found or not authorized for user ${userId}`);
            return res.status(404).json({ success: false, message: 'Contract not found or not authorized' });
        }

        if (contract.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Contract is already ${contract.status}` });
        }

        const User = require('../users/user.model');
        const Job = require('../jobs/job.model');
        const respondingUser = await User.findById(userId);

        const mongoose = require('mongoose');
        const session = await mongoose.startSession();
        session.startTransaction();

        let transactionCommitted = false;

        try {
            if (status === 'active' || status === 'accepted' || status === 'accepted') {
                contract.status = 'active';
                contract.signed_at = new Date();
                contract.worker_signature = signature;

                // ✅ Synchronize Job Status: Mark project as assigned
                if (contract.project_id) {
                    const project = await Job.findById(contract.project_id).session(session);
                    if (project && project.status === 'open') {
                        project.status = 'assigned';
                        project.selected_worker_id = userId; // User ID for consistent tracking
                        
                        project.timeline.push({
                            status: 'assigned',
                            timestamp: new Date(),
                            actor: 'system',
                            note: `Project assigned via formal contract signature by worker.`
                        });
                        
                        await project.save({ session });
                        logger.info(`[ContractController] Synchronized Job ${project._id} status to 'assigned'`);
                    }
                }

            } else {
                contract.status = 'rejected';
                
                // Release locked funds back to contractor wallet
                const Wallet = require('../wallet/wallet.model');
                const wallet = await Wallet.findOne({ user: contract.contractor_id }).session(session);
                if (wallet) {
                    const costToReturn = contract.agreement_type === 'fixed' ? Number(contract.total_value) : Number(contract.monthly_rate);
                    
                    if (!isNaN(costToReturn) && costToReturn > 0) {
                        wallet.escrowBalance = Math.max(0, wallet.escrowBalance - costToReturn);
                        wallet.balance += costToReturn;
                        await wallet.save({ session });

                        logger.info(`[ContractController] Released ₹${costToReturn} back to contractor ${contract.contractor_id} wallet.`);
                    }
                }

                // Log Reversal in timeline if rejected
                contract.timeline.push({
                    status: 'rejected',
                    timestamp: new Date(),
                    note: `Proposal rejected. Funds released back to wallet.`,
                    actor: 'system'
                });
            }

            contract.timeline.push({
                status: contract.status,
                timestamp: new Date(),
                note: note || `Contract ${contract.status} by worker.`,
                actor: 'worker'
            });

            await contract.save({ session });
            await session.commitTransaction();
            transactionCommitted = true;
            logger.info(`[ContractController] respondToContract success for ${id}`);

        } catch (innerError) {
            if (!transactionCommitted) {
                await session.abortTransaction();
            }
            throw innerError;
        } finally {
            session.endSession();
        }

        // Notify contractor (Outside transaction to avoid slowing it down)
        try {
            await notifyHelper.onContractResponded(
                contract.contractor_id, 
                contract.title, 
                respondingUser?.name || 'A Professional', 
                contract.status
            );
        } catch (notifyErr) {
            logger.error(`[ContractController] Notification failed: ${notifyErr.message}`);
        }

        return res.status(200).json({
            success: true,
            message: `Contract ${status === 'active' ? 'accepted' : 'rejected'} successfully`,
            data: contract
        });

    } catch (error) {
        logger.error(`[ContractController] Respond to Contract Error: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Failed to respond to contract',
            error: error.message
        });
    }
};

/**
 * Get all contracts for the authenticated user
 * @route   GET /api/v1/contracts
 * @access  Private (Contractor/Worker)
 */
exports.listContracts = async (req, res) => {
    try {
        const userId = req.user._id;
        const { role } = req.user;
        const { status } = req.query;

        const Worker = require('../workers/worker.model');
        const workerProfile = await Worker.findOne({ user: userId });

        const query = role === 'contractor' 
            ? { contractor_id: userId } 
            : { 
                $or: [
                    { worker_id: userId },
                    { worker_id: workerProfile ? workerProfile._id : null }
                ]
            };

        if (status) {
            query.status = status;
        }

        const contracts = await Contract.find(query)
            .sort({ createdAt: -1 })
            .populate('contractor_id', 'name profileImage')
            .populate('worker_id', 'name profileImage')
            .populate('project_id', 'job_title location');

        res.status(200).json({
            success: true,
            count: contracts.length,
            data: contracts
        });
    } catch (error) {
        logger.error('List Contracts Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contracts',
            error: error.message
        });
    }
};

/**
 * Get single contract details
 * @route   GET /api/v1/contracts/:id
 * @access  Private (Contractor/Worker/Admin)
 */
exports.getContractDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const contract = await Contract.findById(id)
            .populate('contractor_id', 'name phone email profileImage')
            .populate('worker_id', 'name phone email profileImage')
            .populate('project_id', 'job_title location');

        if (!contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        // Helper to get ID regardless of population
        const getRefId = (field) => {
            if (!field) return null;
            return field._id ? field._id.toString() : field.toString();
        };

        const contractorId = getRefId(contract.contractor_id);
        const workerIdInContract = getRefId(contract.worker_id);

        // Basic authorization
        const isContractor = contractorId === userId.toString();
        
        const Worker = require('../workers/worker.model');
        const workerProfile = await Worker.findOne({ user: userId });
        
        const isWorkerMatch = workerIdInContract === userId.toString();
        const isProfileMatch = workerProfile && (workerIdInContract === workerProfile._id.toString());
        const isWorker = isWorkerMatch || isProfileMatch;

        const isAuthorized = isContractor || isWorker || req.user.role === 'admin';

        if (!isAuthorized) {
            logger.warn(`[ContractController] Unauthorized access attempt for contract ${id} by user ${userId}`);
            return res.status(403).json({ success: false, message: 'Unauthorized to view this contract' });
        }

        res.status(200).json({
            success: true,
            data: contract
        });
    } catch (error) {
        logger.error('Get Contract Details Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contract details',
            error: error.message
        });
    }
};

/**
 * Terminate or cancel contract
 * @route   PATCH /api/v1/contracts/:id/terminate
 * @access  Private (Contractor/Worker)
 */
exports.terminateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user._id;

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        if (['completed', 'terminated', 'rejected'].includes(contract.status)) {
            return res.status(400).json({ success: false, message: 'Contract cannot be terminated in its current status' });
        }

        // Check ownership
        const isContractor = contract.contractor_id.toString() === userId.toString();
        
        const Worker = require('../workers/worker.model');
        const workerProfile = await Worker.findOne({ user: userId });
        const isWorkerMatch = contract.worker_id.toString() === userId.toString();
        const isProfileMatch = workerProfile && (contract.worker_id.toString() === workerProfile._id.toString());
        const isWorker = isWorkerMatch || isProfileMatch;
        
        if (!isContractor && !isWorker) {
            return res.status(403).json({ success: false, message: 'Unauthorized to terminate this contract' });
        }

        contract.status = 'terminated';
        contract.actual_end_date = new Date();
        contract.timeline.push({
            status: 'terminated',
            timestamp: new Date(),
            note: reason || `Contract terminated early by ${req.user.role}.`,
            actor: req.user.role === 'contractor' ? 'contractor' : 'worker'
        });

        await contract.save();

        // Notify the other party
        const recipientId = isContractor ? contract.worker_id : contract.contractor_id;
        await notifyHelper.onContractTerminated(recipientId, contract.title, req.user.name);

        res.status(200).json({
            success: true,
            message: 'Contract terminated successfully',
            data: contract
        });
    } catch (error) {
        logger.error('Terminate Contract Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to terminate contract',
            error: error.message
        });
    }
};

/**
 * Activate contract (Contractor only, after worker accepted)
 * @route   PATCH /api/v1/contracts/:id/activate
 */
exports.activateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const contractorId = req.user._id;

        const contract = await Contract.findOne({ _id: id, contractor_id: contractorId });
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });

        if (contract.status !== 'accepted') {
            return res.status(400).json({ success: false, message: `Cannot activate contract in ${contract.status} status.` });
        }

        contract.status = 'active';
        contract.timeline.push({
            status: 'active',
            timestamp: new Date(),
            note: 'Contract officially activated. Mobilization started.',
            actor: 'contractor'
        });

        await contract.save();
        await notifyHelper.onContractStatusChanged(contract.worker_id, contract.title, 'active');

        res.status(200).json({ success: true, message: 'Contract activated', data: contract });
    } catch (error) {
        logger.error('Activate Contract Error:', error);
        res.status(500).json({ success: false, message: 'Failed to activate contract' });
    }
};

/**
 * Extend contract (Contractor only)
 * @route   PATCH /api/v1/contracts/:id/extend
 */
exports.extendContract = async (req, res) => {
    try {
        const { id } = req.params;
        const { newEndDate, reason } = req.body;
        const contractorId = req.user._id;

        if (!newEndDate) return res.status(400).json({ success: false, message: 'New end date is required' });

        const contract = await Contract.findOne({ _id: id, contractor_id: contractorId });
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });

        const oldDate = contract.end_date;
        contract.end_date = new Date(newEndDate);
        contract.timeline.push({
            status: contract.status,
            timestamp: new Date(),
            note: `Contract extended from ${oldDate.toDateString()} to ${contract.end_date.toDateString()}. Reason: ${reason || 'Project scope extension.'}`,
            actor: 'contractor'
        });

        await contract.save();
        await notifyHelper.onContractExtended(contract.worker_id, contract.title, newEndDate);

        res.status(200).json({ success: true, message: 'Contract extended successfully', data: contract });
    } catch (error) {
        logger.error('Extend Contract Error:', error);
        res.status(500).json({ success: false, message: 'Failed to extend contract' });
    }
};

/**
 * Raise Dispute on Contract
 * @route   POST /api/v1/contracts/:id/dispute
 */
exports.raiseContractDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user._id;

        const contract = await Contract.findById(id);
        if (!contract) return res.status(404).json({ success: false, message: 'Contract not found' });

        const isAuthorized = 
            contract.contractor_id.toString() === userId.toString() || 
            contract.worker_id.toString() === userId.toString();

        if (!isAuthorized) return res.status(403).json({ success: false, message: 'Unauthorized' });

        contract.status = 'disputed';
        contract.timeline.push({
            status: 'disputed',
            timestamp: new Date(),
            note: `Formal dispute raised: ${reason}`,
            actor: req.user.role
        });

        await contract.save();
        
        const recipientId = contract.contractor_id.toString() === userId.toString() ? contract.worker_id : contract.contractor_id;
        await notifyHelper.onDisputeRaised(recipientId, contract.title, reason);

        res.status(200).json({ success: true, message: 'Dispute raised successfully', data: contract });
    } catch (error) {
        logger.error('Contract Dispute Error:', error);
        res.status(500).json({ success: false, message: 'Failed to raise dispute' });
    }
};

/**
 * Bulk Create Contracts (Contractor only)
 * @route   POST /api/v1/contracts/bulk
 * @access  Private (Contractor)
 */
exports.createBulkContracts = async (req, res) => {
    try {
        const contractorId = req.user._id;
        const { 
            workerIds, 
            workerConfigs, // Optional: array of { workerId, totalValue, monthlyRate, title }
            title, 
            description, 
            agreementType, 
            totalValue: globalTotalValue, 
            monthlyRate: globalMonthlyRate, 
            paymentFrequency,
            startDate, 
            endDate, 
            termsAndConditions,
            currency,
            autoRenew,
            terminationNoticePeriodDays,
            projectId // Extract projectId
        } = req.body;

        const User = require('../users/user.model');
        const Worker = require('../workers/worker.model');

        const rawWorkersToHire = workerConfigs || (workerIds ? workerIds.map(id => ({ workerId: id })) : []);
        const workersToHire = [];

        // Resolve each worker
        for (const w of rawWorkersToHire) {
            let workerUser = await User.findById(w.workerId);
            if (!workerUser) {
                const profile = await Worker.findById(w.workerId).populate('user');
                if (profile) workerUser = profile.user;
            }
            
            if (workerUser) {
                workersToHire.push({
                    ...w,
                    workerId: workerUser._id
                });
            }
        }

        if (workersToHire.length === 0) {
            return res.status(400).json({ success: false, message: 'workerIds or workerConfigs must be a non-empty array.' });
        }

        // Rule 4.5 & 9.3: Total Batch Cost Calculation (supporting individual overrides)
        let totalBatchCost = 0;
        workersToHire.forEach(w => {
            const cost = agreementType === 'fixed' 
                ? (w.totalValue || globalTotalValue) 
                : (w.monthlyRate || globalMonthlyRate);
            totalBatchCost += Number(cost || 0);
        });

        const Wallet = require('../wallet/wallet.model');
        const wallet = await Wallet.findOne({ user: contractorId });
        
        if (!wallet || wallet.balance < totalBatchCost) {
            return res.status(402).json({ 
                success: false, 
                message: `Insufficient wallet balance to cover this bulk contract batch. Required: ₹${totalBatchCost}. Available: ₹${wallet ? wallet.balance : 0}.` 
            });
        }

        // Rule 6.3: Contract created → funds locked (escrow)
        const mongoose = require('mongoose');
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const contractsData = workersToHire.map(w => ({
                contractor_id: contractorId,
                worker_id: w.workerId,
                title: w.title || title,
                description,
                agreement_type: agreementType,
                total_value: agreementType === 'fixed' ? (w.totalValue || globalTotalValue) : undefined,
                monthly_rate: agreementType === 'monthly' ? (w.monthlyRate || globalMonthlyRate) : undefined,
                currency: currency || 'INR',
                payment_frequency: paymentFrequency,
                start_date: startDate,
                end_date: endDate,
                terms_and_conditions: termsAndConditions,
                auto_renew: autoRenew,
                termination_notice_period_days: terminationNoticePeriodDays,
                status: 'pending',
                timeline: [{
                    status: 'pending',
                    timestamp: new Date(),
                    note: 'Bulk recruitment initiated via professional template.',
                    actor: 'contractor'
                }],
                project_id: projectId
            }));

            const contracts = await Contract.insertMany(contractsData, { session });

            // Link all workers to project if projectId is provided
            if (projectId) {
                const Job = require('../jobs/job.model');
                await Job.findByIdAndUpdate(
                    projectId,
                    { $addToSet: { worker_ids: { $each: workersToHire.map(w => w.workerId) } } },
                    { session }
                );
            }

            // Perform Bulk Escrow Lock
            const WalletService = require('../wallet/wallet.service');
            await WalletService.lockEscrow(
                contractorId, 
                null, 
                null, // Multi-worker batch escrow
                totalBatchCost, 
                `Bulk Recruitment: ${title} (${contracts.length} professionals)`
            );

            await session.commitTransaction();

            // Notify each worker
            workersToHire.forEach(w => {
                notifyHelper.onContractReceived(w.workerId, w.title || title, req.user.name).catch((err) => {
                    logger.warn(`[Contract Bulk] Notification failed for worker ${w.workerId}: ${err.message}`);
                });
            });

            res.status(201).json({
                success: true,
                message: `${contracts.length} personalized professional agreements sent and batch funds secured in escrow.`,
                data: contracts
            });
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    } catch (error) {
        logger.error('Create Bulk Contracts Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create bulk contract proposals',
        });
    }
};

/**
 * Download Contract as PDF
 * @route   GET /api/v1/contracts/:id/download
 * @access  Private (Contractor/Worker)
 */
exports.downloadContractPDF = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const PDFService = require('../../common/services/pdf.service');

        const contract = await Contract.findById(id)
            .populate('contractor_id', 'name email phone')
            .populate('worker_id', 'name email phone');

        if (!contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        // Auth check
        const isAuthorized = 
            contract.contractor_id._id.toString() === userId.toString() || 
            contract.worker_id._id.toString() === userId.toString();

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: 'Unauthorized to download this contract' });
        }

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: 'Helvetica', sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
                    .header { border-bottom: 2px solid #008080; padding-bottom: 20px; margin-bottom: 30px; }
                    .title { font-size: 28px; font-weight: bold; color: #008080; }
                    .status { font-size: 14px; text-transform: uppercase; color: #64748b; font-weight: bold; }
                    .section { margin-bottom: 25px; }
                    .section-title { font-size: 12px; font-weight: bold; color: #008080; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; margin-bottom: 10px; }
                    .grid { display: flex; justify-content: space-between; margin-bottom: 20px; }
                    .col { width: 48%; }
                    .label { font-size: 11px; color: #64748b; font-weight: bold; }
                    .value { font-size: 14px; font-weight: bold; }
                    .terms { font-size: 12px; white-space: pre-wrap; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; }
                    .footer { margin-top: 50px; font-size: 10px; text-align: center; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="status">Official Agreement Record [${contract.status}]</div>
                    <div class="title">${contract.title}</div>
                </div>

                <div class="grid">
                    <div class="col">
                        <div class="section-title">Contractor Details</div>
                        <div class="value">${contract.contractor_id.name}</div>
                        <div class="label">${contract.contractor_id.email}</div>
                    </div>
                    <div class="col">
                        <div class="section-title">Worker Details</div>
                        <div class="value">${contract.worker_id.name}</div>
                        <div class="label">${contract.worker_id.email}</div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Agreement Value</div>
                    <div class="value">
                        ${contract.agreement_type === 'retainer' 
                            ? '₹' + contract.monthly_rate + ' Monthly Retainer' 
                            : '₹' + contract.total_value + ' Total Project Value'}
                    </div>
                    <div class="label">Payment Frequency: ${contract.payment_frequency}</div>
                </div>

                <div class="section">
                    <div class="section-title">Validity Dates</div>
                    <div class="value">
                        Starts: ${new Date(contract.start_date).toLocaleDateString()} &nbsp;|&nbsp; 
                        Ends: ${new Date(contract.end_date).toLocaleDateString()}
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Terms & Conditions</div>
                    <div class="terms">${contract.terms_and_conditions}</div>
                </div>

                <div class="section">
                    <div class="section-title">Signatures</div>
                    <div class="grid">
                        <div class="col">
                            <div class="label">Contractor Digital Signature</div>
                            <div class="value">${contract.contractor_id.name}</div>
                            <div class="label">Time: ${new Date(contract.createdAt).toLocaleString()}</div>
                        </div>
                        <div class="col">
                            <div class="label">Worker Digital Signature</div>
                            <div class="value">${contract.status === 'active' ? contract.worker_id.name : 'PENDING'}</div>
                            <div class="label">Time: ${contract.signed_at ? new Date(contract.signed_at).toLocaleString() : 'N/A'}</div>
                        </div>
                    </div>
                </div>

                <div class="footer">
                    This is an electronically generated legal document from SkillBridge Marketplace.
                    Validated under IT Act 2000. Document Hash: ${contract._id}
                </div>
            </body>
            </html>
        `;

        const pdfBuffer = await PDFService.generatePDF(html);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=SB_Agreement_${contract._id.toString().slice(-6)}.pdf`);
        res.status(200).send(pdfBuffer);
    } catch (error) {
        logger.error('Download Contract PDF Error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
};

