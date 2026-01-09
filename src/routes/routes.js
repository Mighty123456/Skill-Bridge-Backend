const express = require('express');
const authRoutes = require('../modules/auth/auth.routes');
const adminRoutes = require('../modules/admin/admin.routes');

const router = express.Router();

// Root route
router.get('/', (req, res) => {
  const { getBackendURL } = require('../common/utils/backend-urls');

  res.json({
    success: true,
    message: 'SkillBridge API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
    },
    services: {
      otp: getBackendURL('otp'),
      upload: getBackendURL('upload'),
    },
  });
});

// Health check route
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'SkillBridge API is running',
    timestamp: new Date().toISOString(),
  });
});

// Test email configuration (development only)
if (process.env.NODE_ENV !== 'production') {
  router.post('/test-email', async (req, res) => {
    const { sendOTPEmail, initializeTransporter } = require('../common/services/email.service');
    const config = require('../config/env');
    const logger = require('../config/logger');

    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required',
        });
      }

      // Log current email configuration (without password)
      logger.info('📧 Email Configuration:');
      logger.info(`   HOST: ${config.EMAIL_HOST}`);
      logger.info(`   PORT: ${config.EMAIL_PORT}`);
      logger.info(`   USER: ${config.EMAIL_USER}`);
      logger.info(`   PASS: ${config.EMAIL_PASS ? '***SET***' : 'NOT SET'}`);

      // Test transporter initialization
      logger.info('Testing transporter initialization...');
      const initialized = await initializeTransporter();

      if (!initialized) {
        return res.status(500).json({
          success: false,
          message: 'Failed to initialize email transporter. Check server logs for details.',
          config: {
            host: config.EMAIL_HOST,
            port: config.EMAIL_PORT,
            user: config.EMAIL_USER,
            passSet: !!config.EMAIL_PASS,
          },
        });
      }

      // Send test email
      const testOTP = '123456';
      logger.info(`Sending test email to ${email}...`);
      const result = await sendOTPEmail(email, testOTP, 'login');

      if (result.success) {
        return res.json({
          success: true,
          message: 'Test email sent successfully!',
          email: email,
          note: 'Check your inbox. If you don\'t see it, check spam folder.',
        });
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to send test email',
          error: result.error || result.message,
          code: result.code,
        });
      }
    } catch (error) {
      logger.error(`Test email error: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: 'Error testing email service',
        error: error.message,
      });
    }
  });
}

// API routes
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/jobs', require('../modules/jobs/job.routes'));
// router.use('/jobs', require('../modules/jobs/job.routes'));
router.use('/notifications', require('../modules/notifications/notification.routes'));

// Add other route modules here
// router.use('/users', userRoutes);
// router.use('/workers', workerRoutes);
// router.use('/jobs', jobRoutes);

module.exports = router;

