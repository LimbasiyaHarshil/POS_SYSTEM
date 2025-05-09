require('dotenv').config();
const app = require('./src/app');
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const { setupSocket } = require('./src/sockets');

const prisma = new PrismaClient();

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.io
setupSocket(server);

// Server port
const PORT = process.env.PORT || 5000;

// Start server
async function startServer() {
  try {
    // Connect to database
    await prisma.$connect();
    console.log('Connected to database');

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  server.close(() => process.exit(1));
});

startServer();