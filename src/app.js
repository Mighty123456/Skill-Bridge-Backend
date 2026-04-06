const config = require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const routes = require('./routes/routes');
const { errorHandler, notFound } = require('./common/middleware/error.middleware');
const logger = require('./config/logger');

const app = express();

// Trust proxy - Required for rate limiting behind proxies (e.g. Vercel, Heroku, Nginx)
app.set('trust proxy', 1);

// Security Headers
app.use(helmet());

// Compression
app.use(compression());

// Request logging (Morgan for development)
if (config.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate Limiting
let limiter;
if (config.NODE_ENV !== 'development') {
  limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, 
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again after 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Apply rate limiter to all routes
if (config.NODE_ENV !== 'development') {
  app.use('/api', limiter);
}

// Middleware
app.use(cors({
  origin: config.FRONTEND_URL || '*',
  credentials: false,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/payments/webhook')) {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json({ limit: '50mb' })(req, res, next);
  }
});
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Custom Request logging
app.use((req, res, next) => {
  if (config.NODE_ENV !== 'production') {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SkillBridge API Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
    },
  });
});

// Routes
app.use('/api', routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;

