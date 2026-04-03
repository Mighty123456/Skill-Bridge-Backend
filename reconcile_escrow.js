const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Wallet = require('./src/modules/wallet/wallet.model');
const Payment = require('./src/modules/payments/payment.model');

async function fixWallet() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const wallets = await Wallet.find({ escrowBalance: { $gt: 0 } });
        
        console.log(`🔍 Found ${wallets.length} wallets with escrow balances.`);
        
        for (const wallet of wallets) {
            console.log(`\nUser: ${wallet.user}`);
            console.log(`Current Balance: ₹${wallet.balance}`);
            console.log(`Escrow Balance: ₹${wallet.escrowBalance}`);
            
            // Refund ALL escrow to balance (since user manually requested all back)
            // Safety check: only if user has NO active contracts
            const Contract = require('./src/modules/contracts/contract.model');
            const activeContracts = await Contract.find({
                contractor_id: wallet.user,
                status: 'active'
            });

            if (activeContracts.length === 0) {
                console.log(`✅ No active contracts. Returning ₹${wallet.escrowBalance} to balance.`);
                wallet.balance += wallet.escrowBalance;
                wallet.escrowBalance = 0;
                await wallet.save();
                console.log('✅ Balance restored!');
            } else {
                console.log(`⚠️ User has ${activeContracts.length} active contracts. Skipping automatic refund.`);
            }
        }
        
        await mongoose.disconnect();
    } catch(e) { console.error(e); }
}
fixWallet();
