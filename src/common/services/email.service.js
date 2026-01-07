const nodemailer = require('nodemailer');
const config = require('../../config/env');
const logger = require('../../config/logger');

// Use Vercel URL for OTP email links
const BACKEND_URL = config.VERCEL_BACKEND_URL || config.FRONTEND_URL;

// Create email transporter with verification + retry
let transporter = null;

const createTransporter = () => {
  const emailPort = Number(config.EMAIL_PORT);
  const isImplicitTLS = emailPort === 465; // SMTPS
  const isStartTLS = emailPort === 587;    // STARTTLS

  const transporterOptions = {
    host: config.EMAIL_HOST,
    port: emailPort,
    secure: isImplicitTLS, // true for 465 (implicit TLS)
    auth: {
      user: config.EMAIL_USER,
      pass: config.EMAIL_PASS,
    },
    tls: {
      // Do not fail on invalid certificates
      rejectUnauthorized: false,
      // Minimal required for modern TLS
      minVersion: 'TLSv1.2'
    },
    // Nodemailer internal logger
    logger: true,
    debug: true,
  };

  // If using Gmail, use the 'service' shortcut with proper configuration
  if (config.EMAIL_HOST === 'smtp.gmail.com' || config.EMAIL_HOST?.includes('gmail')) {
    logger.info('Using specialized Gmail configuration');
    // Gmail requires App Passwords for SMTP
    // Make sure EMAIL_PASS is a 16-character App Password, not regular password
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.EMAIL_USER,
        pass: config.EMAIL_PASS,
      },
      // Gmail-specific settings
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      // Additional Gmail requirements
      secure: false, // Use STARTTLS
      requireTLS: true,
    });
  }

  // Otherwise use the standard configuration
  if (isStartTLS) {
    transporterOptions.requireTLS = true;
  }

  return nodemailer.createTransport(transporterOptions);
};

const initializeTransporter = async (retries = 3, delayMs = 1000) => {
  // Check if credentials are configured
  if (!config.EMAIL_USER || !config.EMAIL_PASS) {
    logger.error('❌ Email credentials not configured. Email service will be disabled.');
    logger.error(`EMAIL_USER: ${config.EMAIL_USER ? 'SET' : 'NOT SET'}`);
    logger.error(`EMAIL_PASS: ${config.EMAIL_PASS ? 'SET' : 'NOT SET'}`);
    logger.error(`EMAIL_HOST: ${config.EMAIL_HOST}`);
    logger.error(`EMAIL_PORT: ${config.EMAIL_PORT}`);
    return false;
  }

  logger.info(`📧 Initializing email transporter with host: ${config.EMAIL_HOST}, port: ${config.EMAIL_PORT}, user: ${config.EMAIL_USER}`);

  // Additional diagnostics for Vercel deployment
  if (process.env.VERCEL) {
    logger.info('🔍 Running on Vercel - checking environment variables...');
    logger.info(`   EMAIL_HOST: ${config.EMAIL_HOST ? '✅ SET' : '❌ NOT SET'}`);
    logger.info(`   EMAIL_PORT: ${config.EMAIL_PORT ? '✅ SET' : '❌ NOT SET'}`);
    logger.info(`   EMAIL_USER: ${config.EMAIL_USER ? '✅ SET' : '❌ NOT SET'}`);
    logger.info(`   EMAIL_PASS: ${config.EMAIL_PASS ? '✅ SET (length: ' + config.EMAIL_PASS.length + ')' : '❌ NOT SET'}`);

    if (!config.EMAIL_PASS) {
      logger.error('');
      logger.error('⚠️  EMAIL_PASS is NOT SET in Vercel environment variables!');
      logger.error('');
      logger.error('📋 To fix this:');
      logger.error('   1. Go to your Vercel project dashboard');
      logger.error('   2. Navigate to: Settings → Environment Variables');
      logger.error('   3. Add/Update these variables:');
      logger.error('      - EMAIL_HOST = smtp.gmail.com');
      logger.error('      - EMAIL_PORT = 587');
      logger.error('      - EMAIL_USER = your-email@gmail.com');
      logger.error('      - EMAIL_PASS = your-16-char-app-password');
      logger.error('   4. Redeploy your application');
      logger.error('');
    }
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      transporter = createTransporter();
      logger.info(`Attempting to verify SMTP connection (attempt ${attempt}/${retries})...`);
      await transporter.verify();
      logger.info('✅ Mail Services are online and ready to deliver!');
      return true;
    } catch (error) {
      logger.error(`❌ SMTP init attempt ${attempt} failed:`);
      logger.error(`   Error: ${error.message}`);
      logger.error(`   Code: ${error.code || 'N/A'}`);
      logger.error(`   Command: ${error.command || 'N/A'}`);
      if (error.response) {
        logger.error(`   Response: ${error.response}`);
      }
      if (error.responseCode) {
        logger.error(`   Response Code: ${error.responseCode}`);
      }

      // Common Gmail errors with specific guidance
      if (error.code === 'EAUTH' || (error.response && error.response.includes('535'))) {
        logger.error('');
        logger.error('   ⚠️  GMAIL AUTHENTICATION FAILED - Username and Password not accepted');
        logger.error('');
        logger.error('   📋 SOLUTION: You MUST use a Gmail App Password, not your regular password!');
        logger.error('');
        logger.error('   Step-by-step fix:');
        logger.error('   1. Go to: https://myaccount.google.com/security');
        logger.error('   2. Enable "2-Step Verification" (if not already enabled)');
        logger.error('   3. Go to: https://myaccount.google.com/apppasswords');
        logger.error('   4. Select "Mail" and "Other (Custom name)"');
        logger.error('   5. Enter name: "SkillBridge Backend"');
        logger.error('   6. Click "Generate"');
        logger.error('   7. Copy the 16-character password (no spaces)');
        logger.error('   8. Update your .env file: EMAIL_PASS=your-16-char-app-password');
        logger.error('   9. Restart your server');
        logger.error('');
        logger.error('   ⚠️  Important:');
        logger.error('   - Use the App Password (16 characters, no spaces)');
        logger.error('   - NOT your regular Gmail password');
        logger.error('   - NOT your 2-Step Verification code');
        logger.error('   - EMAIL_USER should be your full Gmail address');
        logger.error('');
        logger.error('   Help: https://support.google.com/accounts/answer/185833');
      }
      if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
        logger.error('   ⚠️  Connection failed. Check your EMAIL_HOST and EMAIL_PORT.');
        logger.error('   Also check if your firewall/network allows SMTP connections.');
      }

      if (attempt === retries) {
        logger.error('❌ All SMTP initialization attempts failed. Email service disabled.');
        return false;
      }
      const backoff = delayMs * Math.pow(2, attempt - 1);
      logger.info(`Retrying in ${backoff}ms...`);
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
  return false;
};

/**
 * Send OTP email
 * @param {String} email - Recipient email
 * @param {String} otp - OTP code
 * @param {String} purpose - Purpose (login, reset, etc.)
 */
const sendOTPEmail = async (email, otp, purpose = 'login') => {
  logger.info(`📧 Attempting to send OTP email to: ${email} for purpose: ${purpose}`);

  // Check if transporter exists, if not initialize it
  if (!transporter) {
    logger.info('Transporter not initialized, attempting to initialize...');
    const ready = await initializeTransporter();
    if (!ready) {
      logger.error(`❌ Email service not configured. OTP for ${email}: ${otp}`);
      logger.error('⚠️  Please check your .env file and ensure EMAIL_USER, EMAIL_PASS, EMAIL_HOST, and EMAIL_PORT are set correctly.');
      return { success: false, message: 'Email service not configured', error: 'Transporter initialization failed' };
    }
  }

  // Verify transporter is still working before sending
  try {
    await transporter.verify();
  } catch (verifyError) {
    logger.warn('Transporter verification failed, reinitializing...');
    const ready = await initializeTransporter();
    if (!ready) {
      logger.error(`❌ Failed to reinitialize transporter. OTP for ${email}: ${otp}`);
      return { success: false, message: 'Email service connection failed', error: verifyError.message };
    }
  }

  try {
    // Human‑readable purpose text and action line for the email
    let purposeText;
    let actionLine;

    if (purpose === 'login') {
      purposeText = 'login';
      actionLine = 'Use this code to login at';
    } else if (purpose === 'reset') {
      purposeText = 'password reset';
      actionLine = 'Use this code to reset your password at';
    } else if (purpose === 'registration') {
      purposeText = 'email verification';
      actionLine = 'Use this code to verify your email at';
    } else {
      // Fallback for any other custom purposes
      purposeText = purpose;
      actionLine = 'Use this code at';
    }
    const { getAuthURL } = require('../utils/backend-urls');
    const authBaseURL = getAuthURL('');

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: `Your SkillBridge ${purposeText} code`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4A90E2;">SkillBridge Verification Code</h2>
          <p>Hello,</p>
          <p>Your verification code for ${purposeText} is:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #4A90E2; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>${actionLine}: <a href="${authBaseURL}">${authBaseURL}</a></p>
          <p>If you didn't request this code, please ignore this email.</p>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">
            Need help? Contact us at support@skillbridge.com
          </p>
          <p>Best regards,<br>The SkillBridge Team</p>
        </div>
      `,
    };

    logger.info(`Sending email from ${config.EMAIL_USER} to ${email}...`);
    const result = await transporter.sendMail(mailOptions);
    logger.info(`✅ OTP email sent successfully to ${email}`);
    logger.debug(`Email message ID: ${result.messageId}`);
    return { success: true, message: 'OTP sent successfully', messageId: result.messageId };
  } catch (error) {
    logger.error(`❌ Error sending OTP email to ${email}:`);
    logger.error(`   Error Message: ${error.message}`);
    logger.error(`   Error Code: ${error.code || 'N/A'}`);
    logger.error(`   Error Command: ${error.command || 'N/A'}`);
    if (error.response) {
      logger.error(`   SMTP Response: ${error.response}`);
    }
    if (error.responseCode) {
      logger.error(`   SMTP Response Code: ${error.responseCode}`);
    }
    if (error.stack) {
      logger.error(`   Stack: ${error.stack}`);
    }

    // Provide helpful error messages
    if (error.code === 'EAUTH') {
      logger.error('   ⚠️  Authentication failed. Please check your email credentials.');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      logger.error('   ⚠️  Connection failed. Check your network and SMTP settings.');
    } else if (error.code === 'EMESSAGE') {
      logger.error('   ⚠️  Message formatting error.');
    }

    // Do not break the calling flow; surface a failure result instead.
    // OTP is already generated/stored, so callers can decide how to proceed.
    return {
      success: false,
      message: 'Failed to send OTP email',
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Send welcome email
 */
const sendWelcomeEmail = async (email, name) => {
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) {
      logger.info(`Welcome email skipped; email service not configured. Intended for ${email}`);
      return { success: false, message: 'Email service not configured' };
    }
  }

  try {
    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to SkillBridge!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4A90E2;">Welcome to SkillBridge!</h2>
          <p>Hello ${name},</p>
          <p>Thank you for joining SkillBridge! We're excited to have you on board.</p>
          <p>You can now start connecting with skilled professionals or offer your services.</p>
          <p>If you have any questions, feel free to reach out to our support team.</p>
          <p>Best regards,<br>The SkillBridge Team</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Welcome email sent to ${email}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error sending welcome email: ${error.message}`);
    // Don't throw error for welcome email
    return { success: false };
  }
};

/**
 * Send worker verification status update email
 */
const sendVerificationEmail = async (email, name, status, reason = '') => {
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) {
      logger.info(`Verification email skipped; email service not configured. Intended for ${email}`);
      return { success: false, message: 'Email service not configured' };
    }
  }

  try {
    const isApproved = status === 'verified';
    const statusText = isApproved ? 'Verified' : 'Rejected';
    const subject = isApproved
      ? 'Congratulations! Your SkillBridge account is verified'
      : 'Update regarding your SkillBridge verification';

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
          <h2 style="color: ${isApproved ? '#4caf50' : '#f44336'}; text-align: center;">Verification ${statusText}</h2>
          <p>Hello ${name},</p>
          <p>${isApproved
          ? 'We are happy to inform you that your worker profile has been verified! You are now visible to clients in the SkillBridge marketplace and can start accepting jobs.'
          : `We have reviewed your application and unfortunately, we couldn't verify your profile at this time.`
        }</p>
          
          ${!isApproved && reason ? `
          <div style="background-color: #fff5f5; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0;">
            <strong>Reason for rejection:</strong><br/>
            ${reason}
          </div>
          <p>Please address the issues mentioned above and update your profile for another review.</p>
          ` : ''}
          
          ${isApproved ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${config.FRONTEND_URL}" style="background-color: #4A90E2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Marketplace</a>
          </div>
          ` : ''}
          
          <p>If you have any questions, please contact our support team at support@skillbridge.com.</p>
          <p>Best regards,<br>The SkillBridge Team</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Verification status email (${status}) sent to ${email}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error sending verification email: ${error.message}`);
    return { success: false };
  }
};

/**
 * Initialize email service on startup
 */
const initializeEmailService = async () => {
  return await initializeTransporter();
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  initializeEmailService,
  initializeTransporter
};

