const { verifyToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');
const logger = require('../../config/logger');
const User = require('../../modules/users/user.model');
const Admin = require('../../modules/admin/admin.model');

/**
 * Middleware to authenticate user via JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header or query param
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      logger.debug('Auth Middleware: No token provided in header or query');
      return errorResponse(res, 'No token provided. Please login first.', 401);
    }
    logger.debug('Auth Middleware: Verifying token...');

    // Verify token
    const decoded = verifyToken(token);

    // Get user from database
    // Token usually contains userId and role. We can use role to decide where to look, 
    // or try both if role isn't strictly relied upon here.

    let user = await User.findById(decoded.userId).select('-password +currentSessionId');
    let role = user?.role;

    // If not found in User, check Admin
    if (!user) {
      user = await Admin.findById(decoded.userId).select('-password');
      if (user) {
        role = user.role;
      }
    }

    if (!user) {
      return errorResponse(res, 'User not found. Token is invalid.', 401);
    }

    if (user.isActive === false) {
      return errorResponse(res, 'Your account has been deactivated. Please contact support.', 403);
    }

    // Device Binding Check (Concurrent Login Prevention)
    if (user.currentSessionId && decoded.sessionId !== user.currentSessionId) {
      return errorResponse(res, 'Session expired due to login on another device.', 401);
    }

    // Attach user to request
    req.user = user;
    req.userId = decoded.userId;
    req.userRole = role; // make available for role middleware
    next();
  } catch (error) {
    return errorResponse(res, 'Invalid or expired token. Please login again.', 401);
  }
};

module.exports = {
  authenticate
};

