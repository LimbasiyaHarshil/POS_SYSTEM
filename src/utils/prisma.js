const { PrismaClient } = require('@prisma/client');

// Create a singleton PrismaClient instance
const prisma = new PrismaClient();

module.exports = prisma;