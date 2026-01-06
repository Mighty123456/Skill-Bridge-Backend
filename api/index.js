const app = require('../src/app');
const connectDB = require('../src/config/db');

// Ensure DB connection is ready before handling any request (serverless entry)
let dbReady;
const ensureDB = () => {
  if (!dbReady) {
    dbReady = connectDB();
  }
  return dbReady;
};

// Export the Express app as a serverless function that waits for DB
module.exports = async (req, res) => {
  try {
    if (process.env.MONGODB_URI) {
      await ensureDB();
    }
    return app(req, res);
  } catch (err) {
    console.error('Database connection error:', err);
    res.statusCode = 500;
    res.end('Database connection error');
  }
};

