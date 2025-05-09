const jwt = require('jsonwebtoken');

/**
 * Generate JWT Token
 * @param {object} user - User object with id
 * @returns {string} JWT token
 */
exports.generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id,
      role: user.role,
      restaurantId: user.restaurantId 
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN
    }
  );
};