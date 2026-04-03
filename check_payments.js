const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const Payment = require('./src/modules/payments/payment.model');

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const ps = await Payment.find({ user: '69c6bed872e3f10b329df59a' });
    console.log(JSON.stringify(ps.map(p => ({ 
        type: p.type, 
        status: p.status, 
        amount: p.amount, 
        method: p.paymentMethod,
        txnId: p.transactionId,
        createdAt: p.createdAt 
    })), null, 2));
    process.exit(0);
}
check();
