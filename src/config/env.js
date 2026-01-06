require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || process.env.RENDER_PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/skillbridge',
  JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  JWT_EXPIRE: process.env.JWT_EXPIRE || '7d',
  OTP_EXPIRE: process.env.OTP_EXPIRE || 600000, // 10 minutes in milliseconds
  EMAIL_HOST: process.env.EMAIL_HOST || 'smtp.gmail.com',
  EMAIL_PORT: process.env.EMAIL_PORT || 587,
  EMAIL_USER: process.env.EMAIL_USER || '',
  EMAIL_PASS: process.env.EMAIL_PASS || '',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Backend URLs for different services
  VERCEL_BACKEND_URL: process.env.VERCEL_BACKEND_URL || 'https://skill-bridge-backend-delta.vercel.app',
  RENDER_BACKEND_URL: process.env.RENDER_BACKEND_URL || 'https://skill-bridge-backend-1erz.onrender.com',
  // Cloudinary Configuration
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
};

