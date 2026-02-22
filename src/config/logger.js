const config = require('./env');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../../debug.log');

const writeLog = (msg) => {
  // Don't try to write to files in production/serverless environments (like Vercel)
  if (config.NODE_ENV === 'production') return;

  try {
    fs.appendFileSync(logFile, msg + '\n');
  } catch (err) {
    if (config.NODE_ENV !== 'test') {
      console.error(`Failed to write to log file: ${err.message}`);
    }
  }
};

// Simple logger - can be replaced with winston or pino in production
const logger = {
  info: (message) => {
    const msg = `[INFO] ${new Date().toISOString()} - ${message} `;
    if (config.NODE_ENV !== 'test') {
      console.log(msg);
    }
    writeLog(msg);
  },
  error: (message) => {
    const msg = `[ERROR] ${new Date().toISOString()} - ${message} `;
    console.error(msg);
    if (message && typeof message === 'string') {
      writeLog(msg);
    } else {
      writeLog(JSON.stringify(message));
    }
  },
  warn: (message) => {
    const msg = `[WARN] ${new Date().toISOString()} - ${message} `;
    console.warn(msg);
    writeLog(msg);
  },
  debug: (message) => {
    if (config.NODE_ENV === 'development') {
      const msg = `[DEBUG] ${new Date().toISOString()} - ${message} `;
      console.log(msg);
      writeLog(msg);
    }
  }
};

module.exports = logger;
