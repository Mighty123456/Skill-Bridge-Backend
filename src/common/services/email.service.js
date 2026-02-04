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
 * Base email template wrapper for consistent branding
 */
const baseEmailTemplate = (content, title = 'SkillBridge Notification') => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { text-decoration: none; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <div style="background-color: #f5f5f5; padding: 40px 0;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 0 auto;">
      <!-- Logo / Header -->
      <tr>
        <td align="center" style="padding: 0 0 20px 0;">
          <!-- Optional: <img src="LOGO_URL" alt="SkillBridge" width="48" style="display: block; margin-bottom: 10px;"> -->
        </td>
      </tr>
      
      <!-- Main Card -->
      <tr>
        <td>
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);">
            <!-- Colored Header Bar -->
            <tr>
              <td align="center" style="background-color: #008080; padding: 32px 40px;">
                <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">SkillBridge</h1>
                <p style="color: rgba(255, 255, 255, 0.9); margin: 6px 0 0 0; font-size: 13px; font-weight: 500;">Connecting Skills, Building Futures</p>
              </td>
            </tr>
            
            <!-- Content Area -->
            <tr>
              <td style="padding: 40px; color: #374151; font-size: 16px; line-height: 1.6;">
                ${content}
              </td>
            </tr>
            
            <!-- Footer Area -->
            <tr>
              <td style="background-color: #f9fafb; padding: 24px 40px; border-top: 1px solid #e5e7eb; text-align: center;">
                <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 12px;">
                  &copy; ${new Date().getFullYear()} SkillBridge Inc. All rights reserved.
                </p>
                <div style="margin-bottom: 12px;">
                  <a href="#" style="color: #008080; font-weight: 600; font-size: 12px; margin: 0 10px;">Help Center</a>
                  <a href="#" style="color: #008080; font-weight: 600; font-size: 12px; margin: 0 10px;">Privacy Policy</a>
                  <a href="#" style="color: #008080; font-weight: 600; font-size: 12px; margin: 0 10px;">Terms</a>
                </div>
                <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                  You received this email because you are registered on SkillBridge.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      
      <!-- Bottom Spacer -->
      <tr>
        <td height="40"></td>
      </tr>
    </table>
  </div>
</body>
</html>
`;

/**
 * Send OTP email
 */
const sendOTPEmail = async (email, otp, purpose = 'login') => {
  logger.info(`📧 Attempting to send OTP email to: ${email} for purpose: ${purpose}`);

  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) return { success: false, message: 'Email service not configured' };
  }

  try {
    let purposeTitle, purposeDesc;
    if (purpose === 'login') {
      purposeTitle = 'Login Verification';
      purposeDesc = 'to access your SkillBridge account';
    } else if (purpose === 'reset') {
      purposeTitle = 'Password Reset';
      purposeDesc = 'to reset your password';
    } else {
      purposeTitle = 'Email Verification';
      purposeDesc = 'to verify your identity';
    }

    const html = baseEmailTemplate(`
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">${purposeTitle}</h2>
      <p>Hello,</p>
      <p>Your verification code ${purposeDesc} is:</p>
      <div style="margin: 30px 0; background-color: #f0fdfa; border: 1px dashed #008080; border-radius: 12px; padding: 24px; text-align: center;">
        <span style="font-size: 32px; font-weight: 700; color: #008080; letter-spacing: 8px; font-family: monospace;">${otp}</span>
      </div>
      <p style="font-size: 14px; color: #6b7280;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
    `, `SkillBridge - ${purposeTitle}`);

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: `${otp} is your ${purposeTitle} code`,
      html,
    };

    const result = await transporter.sendMail(mailOptions);
    logger.info(`✅ OTP email sent successfully to ${email}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error(`❌ Error sending OTP email: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Send welcome email
 */
const sendWelcomeEmail = async (email, name) => {
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) return { success: false };
  }

  try {
    const html = baseEmailTemplate(`
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Welcome to SkillBridge, ${name}!</h2>
      <p>We're thrilled to have you join our community of professionals. Whether you're here to offer your expertise or looking for top-tier talent, you're in the right place.</p>
      <p>Here's what you can do now:</p>
      <ul style="padding-left: 20px; margin: 20px 0;">
        <li style="margin-bottom: 10px;">Complete your professional profile</li>
        <li style="margin-bottom: 10px;">Browse available job opportunities</li>
        <li style="margin-bottom: 10px;">Connect with skilled contractors</li>
      </ul>
      <div style="margin-top: 30px; text-align: center;">
        <a href="${config.FRONTEND_URL}/dashboard" style="background-color: #008080; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 16px;">Go to Dashboard</a>
      </div>
    `, 'Welcome to SkillBridge');

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to SkillBridge! 🚀',
      html,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Welcome email sent to ${email}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error sending welcome email: ${error.message}`);
    return { success: false };
  }
};

/**
 * Send worker verification status update email
 */
const sendVerificationEmail = async (email, name, status, reason = '') => {
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) return { success: false };
  }

  try {
    const isApproved = status === 'verified';
    const statusText = isApproved ? 'Approved' : 'Action Required';
    const statusColor = isApproved ? '#10b981' : '#ef4444';

    const html = baseEmailTemplate(`
      <div style="text-align: center; margin-bottom: 30px;">
        <div style="display: inline-block; padding: 6px 16px; border-radius: 9999px; background-color: ${statusColor}15; color: ${statusColor}; font-weight: 600, font-size: 14px;">
          ${statusText}
        </div>
      </div>
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Hi ${name},</h2>
      <p>
        ${isApproved
        ? 'Great news! Your verification application has been approved. Your profile is now live and you can start accepting service requests from clients.'
        : 'Thank you for your verification application. After a careful review, we need a few more details from you before we can approve your profile.'}
      </p>
      
      ${!isApproved && reason ? `
      <div style="background-color: #fef2f2; border-radius: 8px; padding: 20px; margin: 25px 0;">
        <h4 style="margin: 0 0 10px 0; color: #991b1b; font-size: 15px;">Reason for Rejection:</h4>
        <p style="margin: 0; color: #b91c1c; font-size: 14px;">"${reason}"</p>
      </div>
      <p>Please log in to your account and re-submit the required documents based on the feedback above.</p>
      ` : ''}
      
      <div style="margin-top: 35px; text-align: center;">
        <a href="${config.FRONTEND_URL}/dashboard" style="background-color: #008080; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 16px;">
          ${isApproved ? 'Start Working' : 'Update Profile'}
        </a>
      </div>
    `, `SkillBridge Verification ${statusText}`);

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: isApproved
        ? 'Congratulations! Your SkillBridge profile is verified'
        : 'Update regarding your SkillBridge verification',
      html,
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

/**
 * Send quotation accepted email
 */
const sendQuotationAcceptedEmail = async (email, workerName, jobTitle, totalCost) => {
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) return { success: false };
  }

  try {
    const html = baseEmailTemplate(`
      <h2 style="margin-top: 0; font-size: 20px; font-weight: 600; color: #111827;">Congratulations, ${workerName}!</h2>
      <p>Your quotation for the job <strong>"${jobTitle}"</strong> has been accepted by the client.</p>
      
      <div style="background-color: #f3f4f6; border-radius: 8px; padding: 20px; margin: 25px 0;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td style="color: #6b7280; font-size: 14px; padding-bottom: 8px;">Job Title</td>
            <td style="color: #111827; font-size: 14px; font-weight: 600; text-align: right; padding-bottom: 8px;">${jobTitle}</td>
          </tr>
          <tr>
            <td style="color: #6b7280; font-size: 14px;">Total Cost</td>
            <td style="color: #008080; font-size: 18px; font-weight: 700; text-align: right;">₹${totalCost.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <p>Please log in to the SkillBridge app to view complete job details and start working on the task. Good luck!</p>
      
      <div style="margin-top: 35px; text-align: center;">
        <a href="${config.FRONTEND_URL}/dashboard" style="background-color: #008080; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; font-size: 16px;">
          View Job Details
        </a>
      </div>
    `, 'SkillBridge - Quotation Accepted');

    const mailOptions = {
      from: `"SkillBridge" <${config.EMAIL_USER}>`,
      to: email,
      subject: `Your quotation for "${jobTitle}" has been accepted!`,
      html,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Quotation accepted email sent to ${email}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error sending quotation accepted email: ${error.message}`);
    return { success: false };
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendQuotationAcceptedEmail,
  initializeEmailService,
  initializeTransporter
};

