const config = require('../../config/env');

/**
 * Get the appropriate backend URL for different services
 */
const getBackendURL = (service) => {
  switch (service) {
    case 'otp':
    case 'email':
    case 'auth':
      // Use Vercel for OTP and email services
      return config.VERCEL_BACKEND_URL || 'https://skill-bridge-backend-delta.vercel.app';
    
    case 'upload':
    case 'file':
    case 'image':
      // Use Render for file upload services
      return config.RENDER_BACKEND_URL || 'https://skill-bridge-backend-1erz.onrender.com';
    
    default:
      // Default to current host or Render
      return config.RENDER_BACKEND_URL || config.VERCEL_BACKEND_URL || 'http://localhost:3000';
  }
};

/**
 * Get upload endpoint URL
 */
const getUploadURL = (endpoint = '') => {
  const baseURL = getBackendURL('upload');
  return `${baseURL}/api${endpoint}`;
};

/**
 * Get auth endpoint URL
 */
const getAuthURL = (endpoint = '') => {
  const baseURL = getBackendURL('auth');
  return `${baseURL}/api${endpoint}`;
};

module.exports = {
  getBackendURL,
  getUploadURL,
  getAuthURL,
};

