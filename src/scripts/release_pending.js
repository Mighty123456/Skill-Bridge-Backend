const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const WalletSchema = new mongoose.Schema({
    balance: Number,
    pendingBalance: Number,
    pendingPayouts: Array,
    user: mongoose.Schema.Types.ObjectId
}, { strict: false });

const Wallet = mongoose.model('Wallet', WalletSchema);

async function releaseAll() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const wallets = await Wallet.find({ pendingBalance: { $gt: 0 } });
        console.log(`Found ${wallets.length} wallets with pending funds.`);

        for (let w of wallets) {
            const amount = w.pendingBalance;
            const oldBalance = w.balance || 0;
            
            w.balance = oldBalance + amount;
            w.pendingBalance = 0;
            w.pendingPayouts = [];
            
            await w.save();
            console.log(`✅ RELEASED: ₹${amount} for user ${w.user}. New Balance: ₹${w.balance}`);
        }

        await mongoose.disconnect();
        console.log('\nAll pending balances have been moved to Available Balance.');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

releaseAll();
