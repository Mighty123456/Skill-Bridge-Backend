const express = require('express');
const authRoutes = require('../modules/auth/auth.routes');

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

// API routes
router.use('/auth', authRoutes);

// Add other route modules here
// router.use('/users', userRoutes);
// router.use('/workers', workerRoutes);
// router.use('/jobs', jobRoutes);

module.exports = router;

