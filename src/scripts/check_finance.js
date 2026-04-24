const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const WalletSchema = new mongoose.Schema({
    pendingBalance: Number,
    user: mongoose.Schema.Types.ObjectId
}, { strict: false });

const WithdrawalSchema = new mongoose.Schema({
    amount: Number,
    status: String
}, { strict: false });

const Wallet = mongoose.model('Wallet', WalletSchema);
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const wallets = await Wallet.aggregate([
            { $group: { _id: null, total: { $sum: '$pendingBalance' } } }
        ]);

        const pendingWithdrawals = await Withdrawal.aggregate([
            { $match: { status: 'pending' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        console.log('\n--- FINANCIAL DIAGNOSTICS ---');
        console.log('Total Cooling-Window Balance (In Wallets): ₹' + (wallets[0]?.total || 0));
        console.log('Total Pending Withdrawal Requests: ₹' + (pendingWithdrawals[0]?.total || 0));
        
        const pendingWList = await Withdrawal.find({ status: 'pending' });
        if (pendingWList.length > 0) {
            console.log('\n--- ACTIVE WITHDRAWAL REQUESTS ---');
            pendingWList.forEach(w => {
                console.log(`- Request ID: ${w._id}, Amount: ₹${w.amount}`);
            });
        } else {
            console.log('\nNo pending withdrawal requests found.');
        }

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
