const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

/**
 * Protect routes - verify user is authenticated
 */
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Check if token exists in headers
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check if token exists
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          restaurantId: true,
          active: true
        }
      });

      // Check if user exists
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User no longer exists'
        });
      }

      // Check if user is active
      if (!user.active) {
        return res.status(401).json({
          success: false,
          message: 'User account is deactivated'
        });
      }

      // Set user in request
      req.user = user;
      next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Authorize specific roles
 * @param  {...string} roles - Allowed roles
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
};

/**
 * Check if user belongs to the same restaurant or is admin
 */
exports.checkRestaurantAccess = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    
    // Admin can access all restaurants
    if (req.user.role === 'ADMIN') {
      return next();
    }
    
    // Check if user belongs to the requested restaurant
    if (req.user.restaurantId !== restaurantId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access data from this restaurant'
      });
    }
    
    next();
  } catch (error) {
    next(error);
  }
};