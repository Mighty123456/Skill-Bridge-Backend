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

  // If using Gmail, it's often more reliable to use the 'service' shortcut
  if (config.EMAIL_HOST === 'smtp.gmail.com') {
    logger.info('Using specialized Gmail configuration');
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.EMAIL_USER,
        pass: config.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  // Otherwise use the standard configuration
  if (isStartTLS) {
    transporterOptions.requireTLS = true;
  }

  return nodemailer.createTransport(transporterOptions);
};

const initializeTransporter = async (retries = 3, delayMs = 1000) => {
  if (!config.EMAIL_USER || !config.EMAIL_PASS) {
    logger.error('Email credentials not configured. Email service will be disabled.');
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      transporter = createTransporter();
      await transporter.verify();
      logger.info('📧 Mail Services are online and ready to deliver!');
      return true;
    } catch (error) {
      logger.error(`SMTP init attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) {
        return false;
      }
      const backoff = delayMs * Math.pow(2, attempt - 1);
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
  logger.info(`Attempting to send OTP email to: ${email} for purpose: ${purpose}`);
  if (!transporter) {
    const ready = await initializeTransporter();
    if (!ready) {
      logger.warn(`Email service not configured (transporter is null). OTP for ${email}: ${otp}`);
      return { success: false, message: 'Email service not configured' };
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

    await transporter.sendMail(mailOptions);
    logger.info(`OTP email sent to ${email}`);
    return { success: true, message: 'OTP sent successfully' };
  } catch (error) {
    logger.error(`Error sending OTP email: ${error.message}`);
    // Do not break the calling flow; surface a failure result instead.
    // OTP is already generated/stored, so callers can decide how to proceed.
    return { success: false, message: 'Failed to send OTP email' };
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

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail
};

