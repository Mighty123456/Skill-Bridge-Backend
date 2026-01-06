const nodemailer = require('nodemailer');
const config = require('./src/config/env');

async function debugEmail() {
    console.log('DEBUG: Email Configuration');
    console.log('EMAIL_USER:', `'${config.EMAIL_USER}'`);
    console.log('EMAIL_PASS:', `'${config.EMAIL_PASS}'`);
    console.log('EMAIL_HOST:', config.EMAIL_HOST);
    console.log('EMAIL_PORT:', config.EMAIL_PORT);

    if (!config.EMAIL_USER || !config.EMAIL_PASS) {
        console.error('ERROR: Missing credentials');
        return;
    }

    const transporter = nodemailer.createTransport({
        host: config.EMAIL_HOST,
        port: config.EMAIL_PORT,
        secure: false,
        auth: {
            user: config.EMAIL_USER,
            pass: config.EMAIL_PASS,
        },
    });

    try {
        console.log('\nChecking SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection successful');

        const mailOptions = {
            from: `"SkillBridge" <${config.EMAIL_USER}>`,
            to: config.EMAIL_USER, // Send to yourself
            subject: 'Debug Email Test',
            text: 'This is a debug email test'
        };

        console.log('\nSending test email...');
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully:', info.messageId);
    } catch (error) {
        console.error('\n❌ FAILED to send email');
        console.error('Error Name:', error.name);
        console.error('Error Message:', error.message);
        console.error('Error Stack:', error.stack);
    }
}

debugEmail();
