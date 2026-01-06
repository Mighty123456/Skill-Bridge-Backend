const express = require('express');
const cors = require('cors');
const routes = require('./routes/routes');
const { errorHandler, notFound } = require('./common/middleware/error.middleware');
const logger = require('./config/logger');
const config = require('./config/env');

const app = express();

// Middleware
app.use(cors({
  origin: config.FRONTEND_URL,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to SkillBridge API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        sendOTP: 'POST /api/auth/send-otp',
        loginOTP: 'POST /api/auth/login-otp',
        forgotPassword: 'POST /api/auth/forgot-password',
        verifyResetOTP: 'POST /api/auth/verify-reset-otp',
        resetPassword: 'POST /api/auth/reset-password',
        profile: 'GET /api/auth/profile',
        uploadProfileImage: 'POST /api/auth/upload-profile-image',
        deleteProfileImage: 'DELETE /api/auth/delete-profile-image',
      },
    },
    documentation: 'See README.md for detailed API documentation',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/api', routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;

