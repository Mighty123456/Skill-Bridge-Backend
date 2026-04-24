const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

const Job = require('./src/modules/jobs/job.model');
const Contract = require('./src/modules/contracts/contract.model');
const Payment = require('./src/modules/payments/payment.model');
const Wallet = require('./src/modules/wallet/wallet.model');

async function cleanupProjectsAndEscrow() {
    try {
        console.log('🚀 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB.');

        // Search terms: Silver Oak and Skyline
        const searchTerms = [/Silver Oak/i, /Skyline/i];

        for (const term of searchTerms) {
            console.log(`\n--- Cleaning up Project: "${term.source}" ---`);

            // 1. Find Jobs
            const jobs = await Job.find({ 
                $or: [
                    { job_title: term },
                    { job_description: term }
                ]
            });
            console.log(`🔍 Found ${jobs.length} jobs.`);

            // 2. Find Contracts
            const initialContracts = await Contract.find({
                $or: [
                    { title: term },
                    { description: term }
                ]
            });
            
            // Collect all related Job and Contract IDs
            const jobIds = jobs.map(j => j._id);
            const contractIds = initialContracts.map(c => c._id);

            // Also find contracts linked to found jobs
            const linkedContracts = await Contract.find({ project_id: { $in: jobIds } });
            linkedContracts.forEach(c => {
                if (!contractIds.some(id => id.equals(c._id))) {
                    contractIds.push(c._id);
                }
            });
            console.log(`🔍 Found ${contractIds.length} related contracts.`);

            // 3. Handle Escrow Refunds (More Thorough)
            const escrowPayments = await Payment.find({
                $or: [
                    { job: { $in: jobIds } },
                    { "gatewayResponse.description": term }
                ],
                type: 'escrow',
                status: { $in: ['completed', 'pending'] }
            });

            console.log(`💸 Found ${escrowPayments.length} escrow payments to refund.`);

            for (const payment of escrowPayments) {
                const wallet = await Wallet.findOne({ user: payment.user });
                if (wallet) {
                    console.log(`💰 Refunding ₹${payment.amount} to User: ${payment.user}`);
                    console.log(`   Description: ${payment.gatewayResponse?.description || 'N/A'}`);
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
            if (jobIds.length > 0) {
                const jobDeleteResult = await Job.deleteMany({ _id: { $in: jobIds } });
                console.log(`🗑️ Deleted ${jobDeleteResult.deletedCount} jobs.`);
            }

            if (contractIds.length > 0) {
                const contractDeleteResult = await Contract.deleteMany({ _id: { $in: contractIds } });
                console.log(`🗑️ Deleted ${contractDeleteResult.deletedCount} contracts.`);
            }

            // Cleanup payments linked to these jobs that were not refunded
            const otherPaymentsResult = await Payment.deleteMany({ 
                job: { $in: jobIds },
                status: { $ne: 'refunded' } 
            });
            console.log(`🗑️ Deleted ${otherPaymentsResult.deletedCount} related payment records.`);
        }

        // Special check for User 69c6bed872e3f10b329df59a's remaining escrow
        console.log('\n--- Final User Check (69c6bed872e3f10b329df59a) ---');
        const remainingEscrow = await Payment.find({
            user: '69c6bed872e3f10b329df59a',
            type: 'escrow',
            status: { $in: ['completed', 'pending'] }
        });

        if (remainingEscrow.length > 0) {
            console.log(`📦 Found ${remainingEscrow.length} more escrow payments for this user. Refunding them too as requested.`);
            const wallet = await Wallet.findOne({ user: '69c6bed872e3f10b329df59a' });
            for (const payment of remainingEscrow) {
                console.log(`💰 Refunding ₹${payment.amount} | Description: ${payment.gatewayResponse?.description}`);
                wallet.balance += payment.amount;
                wallet.escrowBalance = Math.max(0, wallet.escrowBalance - payment.amount);
                payment.status = 'refunded';
                await payment.save();
            }
            await wallet.save();
            console.log(`✅ User wallet updated. New Balance: ₹${wallet.balance}`);
        }

        console.log('\n✅ All cleanups completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB.');
    }
}

cleanupProjectsAndEscrow();
