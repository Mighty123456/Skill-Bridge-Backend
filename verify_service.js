const paymentService = require('./src/modules/payments/payment.service');
// We can't access 'stripe' variable directly if it's not exported,
// but we can check if it exists by calling a function that uses it.
console.log('Payment Service loaded.');
// Actually, I can check config from here
const config = require('./src/config/env');
console.log('STRIPE_SECRET_KEY found:', !!config.STRIPE_SECRET_KEY);
console.log('Key starts with sk_test:', config.STRIPE_SECRET_KEY.startsWith('sk_test'));
