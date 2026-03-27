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
            workerId, 
            title, 
            description, 
            agreementType, 
            totalValue, 
            monthlyRate, 
            paymentFrequency,
            startDate, 
            endDate, 
            termsAndConditions,
            autoRenew,
            terminationNoticePeriodDays
        } = req.body;

        // Explicit validation for required fields
        if (!workerId) return res.status(400).json({ success: false, message: 'Worker ID is required.' });
        if (!title) return res.status(400).json({ success: false, message: 'Contract title is required.' });
        if (!startDate) return res.status(400).json({ success: false, message: 'Start date is required.' });
        if (!endDate) return res.status(400).json({ success: false, message: 'End date is required.' });
        if (!termsAndConditions) return res.status(400).json({ success: false, message: 'Terms and conditions are required.' });
        if (agreementType === 'fixed' && !totalValue) return res.status(400).json({ success: false, message: 'Total value is required for fixed agreements.' });
        if (agreementType === 'retainer' && !monthlyRate) return res.status(400).json({ success: false, message: 'Monthly rate is required for retainer agreements.' });

        // Create the contract
        const contract = await Contract.create({
            contractor_id: contractorId,
            worker_id: workerId,
            title,
            description,
            agreement_type: agreementType,
            total_value: totalValue,
            monthly_rate: monthlyRate,
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
                note: 'Contract offer initiated by contractor.',
                actor: 'contractor'
            }]
        });

        // Notify worker (fire-and-forget – notification failure must NOT fail the whole request)
        notifyHelper.onContractReceived(workerId, title, req.user.name).catch((err) => {
            logger.warn(`[Contract] Notification failed for worker ${workerId}: ${err.message}`);
        });

        res.status(201).json({
            success: true,
            message: 'Contract proposal sent successfully',
            data: contract
        });
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
    try {
        const { id } = req.params;
        const { status, note, signature } = req.body;
        const workerId = req.user._id;

        if (!['active', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid response status' });
        }

        const contract = await Contract.findOne({ _id: id, worker_id: workerId });
        if (!contract) {
            return res.status(404).json({ success: false, message: 'Contract not found or not authorized' });
        }

        if (contract.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Contract is already ${contract.status}` });
        }

        contract.status = status;
        if (status === 'active') {
            contract.signed_at = new Date();
            contract.worker_signature = signature;
        }

        contract.timeline.push({
            status: status,
            timestamp: new Date(),
            note: note || `Worker ${status} the contract proposal.`,
            actor: 'worker'
        });

        await contract.save();

        // Notify contractor
        await notifyHelper.onContractResponded(contract.contractor_id, contract.title, req.user.name, status);

        res.status(200).json({
            success: true,
            message: `Contract ${status} successfully`,
            data: contract
        });
    } catch (error) {
        logger.error('Respond to Contract Error:', error);
        res.status(500).json({
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

        const query = role === 'contractor' 
            ? { contractor_id: userId } 
            : { worker_id: userId };

        if (status) {
            query.status = status;
        }

        const contracts = await Contract.find(query)
            .sort({ createdAt: -1 })
            .populate('contractor_id', 'name profileImage')
            .populate('worker_id', 'name profileImage');

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
            .populate('worker_id', 'name phone email profileImage');

        if (!contract) {
            return res.status(404).json({ success: false, message: 'Contract not found' });
        }

        // Basic authorization
        const isAuthorized = 
            contract.contractor_id._id.toString() === userId.toString() || 
            contract.worker_id._id.toString() === userId.toString() || 
            req.user.role === 'admin';

        if (!isAuthorized) {
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
        const isWorker = contract.worker_id.toString() === userId.toString();
        
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
