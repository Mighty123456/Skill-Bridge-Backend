const mongoose = require('mongoose');
require('dotenv').config();
const Payment = require('./src/modules/payments/payment.model');

async function test() {
    await mongoose.connect(process.env.MONGODB_URI);
    const contractorId = new mongoose.Types.ObjectId('69c6bed872e3f10b329df59a');
    const lifetimeSpend = await Payment.aggregate([
        { $match: { user: contractorId, type: { $in: ['escrow', 'payout'] }, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    console.log('Lifetime Spend Result:', JSON.stringify(lifetimeSpend, null, 2));
    
    const allMatching = await Payment.find({ user: contractorId, type: { $in: ['escrow', 'payout'] }, status: 'completed' });
    console.log('All matching records:', allMatching.length);
    allMatching.forEach(p => console.log(`- type: ${p.type}, amount: ${p.amount}`));
    
    process.exit(0);
}
test();
