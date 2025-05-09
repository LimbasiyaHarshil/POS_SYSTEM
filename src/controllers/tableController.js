const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all tables
 * @route   GET /api/tables
 * @access  Private
 */
exports.getTables = async (req, res, next) => {
  try {
    const { restaurantId, status } = req.query;
    
    // Build filter condition
    const where = {};
    
    // Filter by restaurant
    if (restaurantId) {
      where.restaurantId = restaurantId;
    } else if (req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    const tables = await prisma.table.findMany({
      where,
      include: {
        orders: {
          where: {
            status: {
              in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      },
      orderBy: {
        number: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: tables.length,
      data: tables
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single table
 * @route   GET /api/tables/:id
 * @access  Private
 */
exports.getTable = async (req, res, next) => {
  try {
    const { id } = req.params;

    const table = await prisma.table.findUnique({
      where: { id },
      include: {
        orders: {
          where: {
            status: {
              in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
            }
          },
          include: {
            orderItems: {
              include: {
                menuItem: true,
                modifiers: {
                  include: {
                    modifier: true
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      table.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this table'
      });
    }

    res.status(200).json({
      success: true,
      data: table
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a table
 * @route   POST /api/tables
 * @access  Private/Manager/Admin
 */
exports.createTable = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { number, capacity, status } = req.body;
    let { restaurantId } = req.body;

    // If not admin, can only create for own restaurant
    if (req.user.role !== 'ADMIN') {
      restaurantId = req.user.restaurantId;
    }

    // Check restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check if table number already exists in the restaurant
    const existingTable = await prisma.table.findFirst({
      where: {
        number,
        restaurantId
      }
    });

    if (existingTable) {
      return res.status(400).json({
        success: false,
        message: `Table number ${number} already exists in this restaurant`
      });
    }

    // Create table
    const table = await prisma.table.create({
      data: {
        number,
        capacity,
        status: status || 'AVAILABLE',
        restaurant: {
          connect: { id: restaurantId }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: table
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a table
 * @route   PUT /api/tables/:id
 * @access  Private/Manager/Admin
 */
exports.updateTable = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { number, capacity, status } = req.body;

    // Check if table exists
    const table = await prisma.table.findUnique({
      where: { id }
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      table.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this table'
      });
    }

    // Check if table number already exists in the restaurant (if changing number)
    if (number && number !== table.number) {
      const existingTable = await prisma.table.findFirst({
        where: {
          number,
          restaurantId: table.restaurantId,
          NOT: {
            id
          }
        }
      });

      if (existingTable) {
        return res.status(400).json({
          success: false,
          message: `Table number ${number} already exists in this restaurant`
        });
      }
    }

    // Update table
    const updateData = {};
    if (number !== undefined) updateData.number = number;
    if (capacity !== undefined) updateData.capacity = capacity;
    if (status !== undefined) updateData.status = status;

    const updatedTable = await prisma.table.update({
      where: { id },
      data: updateData
    });

    // If status changed to occupied or available, notify via socket
    if (status && table.status !== status) {
      // Socket notification will be handled by the client
      // through the response
    }

    res.status(200).json({
      success: true,
      data: updatedTable
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a table
 * @route   DELETE /api/tables/:id
 * @access  Private/Manager/Admin
 */
exports.deleteTable = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if table exists
    const table = await prisma.table.findUnique({
      where: { id },
      include: {
        orders: {
          where: {
            status: {
              in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
            }
          }
        }
      }
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      table.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this table'
      });
    }

    // Check if table has active orders
    if (table.orders.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete table with active orders'
      });
    }

    // Delete table
    await prisma.table.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Table deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change table status
 * @route   PUT /api/tables/:id/status
 * @access  Private
 */
exports.changeTableStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be AVAILABLE, OCCUPIED, RESERVED, or MAINTENANCE'
      });
    }

    // Check if table exists
    const table = await prisma.table.findUnique({
      where: { id }
    });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      table.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this table'
      });
    }

    // Update table status
    const updatedTable = await prisma.table.update({
      where: { id },
      data: { status }
    });

    res.status(200).json({
      success: true,
      data: updatedTable
    });
  } catch (error) {
    next(error);
  }
};