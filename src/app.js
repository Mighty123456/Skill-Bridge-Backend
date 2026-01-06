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

// Routes
app.use('/api', routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;

