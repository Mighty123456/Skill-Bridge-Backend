const { verifyToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');
const User = require('../../modules/users/user.model');
const Admin = require('../../modules/admin/admin.model');

/**
 * Middleware to authenticate user via JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Auth Middleware: No token provided or invalid format:', authHeader);
      return errorResponse(res, 'No token provided. Please login first.', 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    console.log('Auth Middleware: Verifying token...');

    // Verify token
    const decoded = verifyToken(token);

    // Get user from database
    // Token usually contains userId and role. We can use role to decide where to look, 
    // or try both if role isn't strictly relied upon here.

    let user = await User.findById(decoded.userId).select('-password');
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

