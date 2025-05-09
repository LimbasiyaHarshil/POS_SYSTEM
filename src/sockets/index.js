const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

/**
 * Socket.io setup
 * @param {Server} server - HTTP server instance
 * @returns {socketIo.Server} Socket.io server instance
 */
exports.setupSocket = (server) => {
  const io = socketIo(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL 
        : '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Authentication middleware for socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                    socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

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

      if (!user || !user.active) {
        return next(new Error('Authentication error: Invalid user'));
      }

      // Attach user to socket
      socket.user = user;
      next();
    } catch (error) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  // Socket.io connection handling
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.id}`);
    
    // Join restaurant-specific room if applicable
    if (socket.user.restaurantId) {
      socket.join(`restaurant:${socket.user.restaurantId}`);
      console.log(`User ${socket.user.id} joined room restaurant:${socket.user.restaurantId}`);
    }

    // Handle order events
    socket.on('new_order', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('new_order', data);
    });

    socket.on('update_order', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('update_order', data);
    });

    socket.on('order_status_change', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('order_status_change', data);
    });

    // Handle table events
    socket.on('table_status_change', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('table_status_change', data);
    });

    // Handle kitchen events
    socket.on('item_ready', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('item_ready', data);
    });

    // Handle inventory events
    socket.on('low_stock_alert', (data) => {
      socket.to(`restaurant:${data.restaurantId}`).emit('low_stock_alert', data);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.id}`);
    });
  });

  return io;
};