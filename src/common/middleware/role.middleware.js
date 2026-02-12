const { errorResponse } = require('../utils/response');
const { ROLES } = require('../constants/roles');

/**
 * Middleware to check if user has required role(s)
 * @param {String|Array} allowedRoles - Role(s) allowed to access the route
 */
const authorize = (...args) => {
  // Flatten arguments to handle authorize('admin', 'user') and authorize(['admin', 'user'])
  const allowedRoles = args.flat();

  return (req, res, next) => {
    if (!req.user) {
      // Should adhere to standard error structure
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userRole = req.user.role;

    if (allowedRoles.length === 0 || allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${allowedRoles.join(' or ')}`
    });
  };
};

/**
 * Middleware to check if user is accessing their own resource or is admin
 */
const authorizeOwnerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return errorResponse(res, 'Authentication required', 401);
  }

  const userId = req.params.userId || req.params.id;
  const isOwner = req.user._id.toString() === userId;
  const isAdmin = req.user.role === ROLES.ADMIN;

  if (isOwner || isAdmin) {
    return next();
  }

  return errorResponse(res, 'Access denied. You can only access your own resources.', 403);
};

module.exports = {
  authorize,
  authorizeOwnerOrAdmin
};

