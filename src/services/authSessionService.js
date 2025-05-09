const prisma = require('../utils/prisma');

/**
 * Track user login session
 * @param {string} userId - The ID of the user logging in
 * @param {object} sessionData - Additional session data like IP address
 * @returns {Promise<object>} Created session
 */
exports.createUserSession = async (userId, sessionData = {}) => {
  try {
    // Get user to find their restaurant
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { restaurantId: true }
    });

    // Create session record
    const session = await prisma.userSession.create({
      data: {
        ipAddress: sessionData.ipAddress || null,
        userAgent: sessionData.userAgent || null,
        user: {
          connect: { id: userId }
        },
        restaurant: user.restaurantId ? {
          connect: { id: user.restaurantId }
        } : undefined
      }
    });

    return session;
  } catch (error) {
    console.error('Error creating user session:', error);
    throw error;
  }
};

/**
 * End a user session (logout)
 * @param {string} sessionId - The ID of the session to end
 * @returns {Promise<object>} Updated session
 */
exports.endUserSession = async (sessionId) => {
  try {
    return await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        logoutTime: new Date(),
        isActive: false
      }
    });
  } catch (error) {
    console.error('Error ending user session:', error);
    throw error;
  }
};

/**
 * End all active sessions for a user (force logout from all devices)
 * @param {string} userId - The ID of the user
 * @returns {Promise<object>} Result of the operation
 */
exports.endAllUserSessions = async (userId) => {
  try {
    return await prisma.userSession.updateMany({
      where: {
        userId,
        isActive: true
      },
      data: {
        logoutTime: new Date(),
        isActive: false
      }
    });
  } catch (error) {
    console.error('Error ending all user sessions:', error);
    throw error;
  }
};

/**
 * Get active sessions for a user
 * @param {string} userId - The ID of the user
 * @returns {Promise<array>} Active sessions
 */
exports.getActiveSessions = async (userId) => {
  try {
    return await prisma.userSession.findMany({
      where: {
        userId,
        isActive: true
      },
      orderBy: {
        loginTime: 'desc'
      }
    });
  } catch (error) {
    console.error('Error getting active sessions:', error);
    throw error;
  }
};

/**
 * Get session history for a user
 * @param {string} userId - The ID of the user
 * @param {number} limit - Max number of sessions to return
 * @returns {Promise<array>} Session history
 */
exports.getSessionHistory = async (userId, limit = 10) => {
  try {
    return await prisma.userSession.findMany({
      where: {
        userId
      },
      orderBy: {
        loginTime: 'desc'
      },
      take: limit
    });
  } catch (error) {
    console.error('Error getting session history:', error);
    throw error;
  }
};