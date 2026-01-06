const { errorResponse } = require('../utils/response');
const { ROLES } = require('../constants/roles');

/**
 * Middleware to check if user has required role(s)
 * @param {String|Array} allowedRoles - Role(s) allowed to access the route
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Authentication required', 401);
    }

    const userRole = req.user.role;

    if (allowedRoles.length === 0 || allowedRoles.includes(userRole)) {
      return next();
    }

    return errorResponse(
      res,
      `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      403
    );
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

