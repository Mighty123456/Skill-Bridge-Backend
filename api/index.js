const app = require('../src/app');
const connectDB = require('../src/config/db');

// Connect to database (only in serverless environment)
if (process.env.MONGODB_URI) {
  connectDB().catch(err => {
    console.error('Database connection error:', err);
  });
}

// Export the Express app as a serverless function
module.exports = app;

