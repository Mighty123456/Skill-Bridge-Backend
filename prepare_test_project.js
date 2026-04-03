const mongoose = require('mongoose');
require('dotenv').config();

const Job = require('./src/modules/jobs/job.model');
const User = require('./src/modules/users/user.model');
const Contract = require('./src/modules/contracts/contract.model');
const JobService = require('./src/modules/jobs/job.service');

async function prepareTest() {
    try {
        console.log('🚀 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('🔍 Finding the most recent active contract...');
        const contract = await Contract.findOne({ status: 'active' })
            .sort({ createdAt: -1 })
            .populate('contractor_id', 'name')
            .populate('worker_id', 'name');

        if (!contract) {
            console.error('❌ NO ACTIVE CONTRACT FOUND in the database.');
            console.log('Please ensure you have at least one signed active contract between a contractor and a worker before running this script.');
            await mongoose.disconnect();
            process.exit(1);
        }

        const CONTRACTOR_ID = contract.contractor_id._id;
        const WORKER_ID = contract.worker_id._id;
        const CONTRACTOR_NAME = contract.contractor_id.name;
        const WORKER_NAME = contract.worker_id.name;

        console.log(`✅ Using Contract: "${contract.title}"`);
        console.log(`👤 Contractor: ${CONTRACTOR_NAME} (${CONTRACTOR_ID})`);
        console.log(`👤 Worker: ${WORKER_NAME} (${WORKER_ID})`);

        console.log('🧹 Cleaning up previous test project for this contract...');
        await Job.deleteMany({ 
            job_title: '[TEST] Skyline Skyline Apartment', 
            user_id: CONTRACTOR_ID 
        });

        console.log('🏗️ Creating new test project for the current contract...');
        const job = new Job({
            user_id: CONTRACTOR_ID,
            job_title: '[TEST] Skyline Skyline Apartment',
            job_description: 'Complex electrical renovation project for testing workforce flow.',
            skill_required: 'Electrician',
            budget: contract.total_value || 50000,
            is_contractor_project: true,
            location: {
                type: 'Point',
                coordinates: [72.5714, 23.0225],
                address_text: 'Skyline Heights, Ahmedabad, Gujarat'
            },
            status: 'assigned', // Start in Workforce phase
            selected_worker_id: WORKER_ID,
            tasks: []
        });

        console.log('📋 Assigning initial task for the worker...');
        job.tasks.push({
            title: 'Circuit Panel Inspection',
            description: 'Inspect all circuit panels in the B-Wing section and report back with a material list.',
            status: 'pending',
            assigned_worker_id: WORKER_ID,
            assigned_worker_name: WORKER_NAME,
            due_date: new Date(Date.now() + 86400000), // Tomorrow
            priority: 'medium'
        });

        // Use the new sync logic to ensure phase is correct
        await JobService.syncProjectStatus(job);
        
        await job.save();

        // Link project back to contract
        contract.project_id = job._id;
        await contract.save();

        console.log('\n✅ TEST CASE READY!');
        console.log('--------------------');
        console.log(`Project ID: ${job._id}`);
        console.log(`Phase: Workforce (Status: ${job.status})`);
        console.log(`Tasks: 1 Assigned to ${WORKER_NAME}`);
        console.log('\n👉 The worker can now see this project in "Workforce" phase and can "START WORK".');

        await mongoose.disconnect();
    } catch (e) {
        console.error('❌ Error preparing test:', e);
        process.exit(1);
    }
}

prepareTest();
