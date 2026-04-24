const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const Payment = require('./src/modules/payments/payment.model');

async function checkPayments() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const payments = await Payment.find({ 
            user: '69c6bed872e3f10b329df59a',
            type: 'escrow', 
            status: { $in: ['completed', 'pending'] } 
        });
        console.log(JSON.stringify(payments, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
checkPayments();
