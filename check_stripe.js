const config = require('./src/config/env');
console.log('Stripe Secret Key Length:', config.STRIPE_SECRET_KEY ? config.STRIPE_SECRET_KEY.length : 0);
console.log('Stripe Publishable Key Length:', config.STRIPE_PUBLISHABLE_KEY ? config.STRIPE_PUBLISHABLE_KEY.length : 0);
console.log('Stripe Webhook Secret Length:', config.STRIPE_WEBHOOK_SECRET ? config.STRIPE_WEBHOOK_SECRET.length : 0);
if (config.STRIPE_SECRET_KEY) {
    console.log('Stripe Secret Key Prefix:', config.STRIPE_SECRET_KEY.substring(0, 7));
}
