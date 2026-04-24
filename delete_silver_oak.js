const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const Job = require('./src/modules/jobs/job.model');
const Contract = require('./src/modules/contracts/contract.model');
const Payment = require('./src/modules/payments/payment.model');
const Wallet = require('./src/modules/wallet/wallet.model');

async function cleanupSilverOak() {
    try {
        console.log('🚀 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB.');

        const searchTerm = /Silver Oak/i;

        // 1. Find Jobs
        const jobs = await Job.find({ 
            $or: [
                { job_title: searchTerm },
                { job_description: searchTerm }
            ]
        });
        console.log(`🔍 Found ${jobs.length} jobs related to "Silver Oak".`);

        // 2. Find Contracts
        const contracts = await Contract.find({
            $or: [
                { title: searchTerm },
                { description: searchTerm }
            ]
        });
        console.log(`🔍 Found ${contracts.length} contracts related to "Silver Oak".`);

        // Collect all related Job and Contract IDs
        const jobIds = jobs.map(j => j._id);
        const contractIds = contracts.map(c => c._id);

        // Also find contracts linked to found jobs
        const linkedContracts = await Contract.find({ project_id: { $in: jobIds } });
        linkedContracts.forEach(c => {
            if (!contractIds.some(id => id.equals(c._id))) {
                contractIds.push(c._id);
            }
        });

        // 3. Handle Escrow Refunds
        console.log('\n--- Processing Escrow Refunds ---');
        
        // Find all escrow payments linked to these jobs
        const escrowPayments = await Payment.find({
            job: { $in: jobIds },
            type: 'escrow',
            status: { $in: ['completed', 'pending'] }
        });

        console.log(`💸 Found ${escrowPayments.length} successful escrow payments to refund.`);

        for (const payment of escrowPayments) {
            const wallet = await Wallet.findOne({ user: payment.user });
            if (wallet) {
                console.log(`💰 Refunding ₹${payment.amount} to User: ${payment.user}`);
                console.log(`   Before: Balance=₹${wallet.balance}, Escrow=₹${wallet.escrowBalance}`);
                
                wallet.balance += payment.amount;
                wallet.escrowBalance = Math.max(0, wallet.escrowBalance - payment.amount);
                
                await wallet.save();
                
                payment.status = 'refunded';
                await payment.save();
                
                console.log(`   After: Balance=₹${wallet.balance}, Escrow=₹${wallet.escrowBalance}`);
            } else {
                console.warn(`⚠️ Wallet not found for User: ${payment.user}`);
            }
        }

        // 4. Delete Records
        console.log('\n--- Deleting Records ---');

        if (jobIds.length > 0) {
            const jobDeleteResult = await Job.deleteMany({ _id: { $in: jobIds } });
            console.log(`🗑️ Deleted ${jobDeleteResult.deletedCount} jobs.`);
        }

        if (contractIds.length > 0) {
            const contractDeleteResult = await Contract.deleteMany({ _id: { $in: contractIds } });
            console.log(`🗑️ Deleted ${contractDeleteResult.deletedCount} contracts.`);
        }

        // Also cleanup payments linked to these jobs that were not refunded (e.g. failed ones or other types)
        const otherPaymentsResult = await Payment.deleteMany({ 
            job: { $in: jobIds },
            status: { $ne: 'refunded' } 
        });
        console.log(`🗑️ Deleted ${otherPaymentsResult.deletedCount} related payment records.`);

        console.log('\n✅ Cleanup completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
    }
}

cleanupSilverOak();
