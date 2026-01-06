/**
 * Email Configuration Test Script
 * Run this to test if your email service is configured correctly
 * 
 * Usage: node test-email.js your-email@example.com
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const testEmail = async (recipientEmail) => {
    console.log('\n🔍 Testing Email Configuration...\n');

    // Check environment variables
    console.log('📋 Environment Variables:');
    console.log(`   EMAIL_HOST: ${process.env.EMAIL_HOST || '❌ NOT SET'}`);
    console.log(`   EMAIL_PORT: ${process.env.EMAIL_PORT || '❌ NOT SET'}`);
    console.log(`   EMAIL_USER: ${process.env.EMAIL_USER || '❌ NOT SET'}`);
    console.log(`   EMAIL_PASS: ${process.env.EMAIL_PASS ? '✅ SET (hidden)' : '❌ NOT SET'}\n`);

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('❌ ERROR: Email credentials not configured!');
        console.log('\n📝 To fix this:');
        console.log('   1. Copy .env.example to .env');
        console.log('   2. Add your Gmail address to EMAIL_USER');
        console.log('   3. Generate Gmail App Password and add to EMAIL_PASS');
        console.log('   4. See EMAIL_OTP_SETUP.md for detailed instructions\n');
        process.exit(1);
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    try {
        // Verify connection
        console.log('🔌 Verifying SMTP connection...');
        await transporter.verify();
        console.log('✅ SMTP connection successful!\n');

        // Send test email
        const testOTP = '123456';
        const recipient = recipientEmail || process.env.EMAIL_USER;

        console.log(`📧 Sending test OTP email to: ${recipient}...`);

        const info = await transporter.sendMail({
            from: `"SkillBridge Test" <${process.env.EMAIL_USER}>`,
            to: recipient,
            subject: 'SkillBridge Email Test - OTP Verification',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4A90E2;">✅ Email Configuration Test Successful!</h2>
          <p>Hello,</p>
          <p>This is a test email from your SkillBridge backend.</p>
          <p>Your test OTP code is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #4A90E2; margin: 0; font-size: 32px; letter-spacing: 5px;">${testOTP}</h1>
          </div>
          <p><strong>If you received this email, your email service is configured correctly! 🎉</strong></p>
          <p>You can now send OTP emails for:</p>
          <ul>
            <li>User Registration</li>
            <li>Login OTP</li>
            <li>Password Reset</li>
          </ul>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">
            This is an automated test email from SkillBridge Backend.
          </p>
        </div>
      `,
        });

        console.log('✅ Test email sent successfully!');
        console.log(`   Message ID: ${info.messageId}`);
        console.log(`   Recipient: ${recipient}\n`);
        console.log('🎉 Email service is working correctly!');
        console.log('📬 Check your inbox (and spam folder) for the test email.\n');

    } catch (error) {
        console.error('❌ Email test failed!\n');
        console.error('Error details:', error.message);

        if (error.message.includes('Invalid login')) {
            console.log('\n💡 Troubleshooting:');
            console.log('   - Make sure you are using a Gmail App Password, not your regular password');
            console.log('   - Generate a new App Password: https://myaccount.google.com/apppasswords');
            console.log('   - Enable 2-Factor Authentication first if not already enabled');
        } else if (error.message.includes('ECONNREFUSED')) {
            console.log('\n💡 Troubleshooting:');
            console.log('   - Check your internet connection');
            console.log('   - Verify EMAIL_HOST and EMAIL_PORT are correct');
        }

        console.log('\n📖 For detailed setup instructions, see: EMAIL_OTP_SETUP.md\n');
        process.exit(1);
    }
};

// Get recipient email from command line argument
const recipientEmail = process.argv[2];

if (!recipientEmail) {
    console.log('ℹ️  No recipient email provided. Using EMAIL_USER as recipient.');
    console.log('   To send to a different email: node test-email.js your-email@example.com\n');
}

testEmail(recipientEmail);
