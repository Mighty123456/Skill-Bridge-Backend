const nodemailer = require('nodemailer');
const config = require('../../config/env');
const logger = require('../../config/logger');

// Use Vercel URL for OTP email links
const BACKEND_URL = config.VERCEL_BACKEND_URL || config.FRONTEND_URL;

// Create email transporter
let transporter;

if (config.EMAIL_USER && config.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: config.EMAIL_HOST,
    port: config.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: config.EMAIL_USER,
      pass: config.EMAIL_PASS,
    },
  });
} else {
  logger.warn('Email credentials not configured. Email service will be disabled.');
}

/**
 * Send OTP email
 * @param {String} email - Recipient email
 * @param {String} otp - OTP code
 * @param {String} purpose - Purpose (login, reset, etc.)
 */
const sendOTPEmail = async (email, otp, purpose = 'login') => {
  if (!transporter) {
    logger.warn(`Email service not configured. OTP for ${email}: ${otp}`);
    return { success: true, message: 'OTP logged (email not configured)' };
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
    logger.info(`Welcome email would be sent to ${email}`);
    return { success: true };
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

