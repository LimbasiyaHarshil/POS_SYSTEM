const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all restaurants
 * @route   GET /api/restaurants
 * @access  Private/Admin
 */
exports.getRestaurants = async (req, res, next) => {
  try {
    const { search, active } = req.query;
    
    // Build filter condition
    const where = {};
    
    // Search by name, address, or email
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    // Filter by active status
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    // If not admin, only show the user's restaurant
    if (req.user.role !== 'ADMIN') {
      if (!req.user.restaurantId) {
        return res.status(200).json({
          success: true,
          count: 0,
          data: []
        });
      }
      where.id = req.user.restaurantId;
    }

    // Get restaurants
    const restaurants = await prisma.restaurant.findMany({
      where,
      include: {
        _count: {
          select: {
            users: true,
            tables: true,
            menuItems: true,
            orders: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: restaurants.length,
      data: restaurants
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single restaurant
 * @route   GET /api/restaurants/:id
 * @access  Private
 */
exports.getRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            tables: true,
            menuItems: true,
            orders: {
              where: {
                status: {
                  in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
                }
              }
            }
          }
        }
      }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      restaurant.id !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this restaurant'
      });
    }

    res.status(200).json({
      success: true,
      data: restaurant
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a restaurant
 * @route   POST /api/restaurants
 * @access  Private/Admin
 */
exports.createRestaurant = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, address, phone, email, taxRate, active } = req.body;

    // Create restaurant
    const restaurant = await prisma.restaurant.create({
      data: {
        name,
        address,
        phone,
        email,
        taxRate: taxRate || 0,
        active: active !== undefined ? active : true
      }
    });

    res.status(201).json({
      success: true,
      data: restaurant
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a restaurant
 * @route   PUT /api/restaurants/:id
 * @access  Private/Admin/Manager
 */
exports.updateRestaurant = async (req, res, next) => {
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
    const { name, address, phone, email, taxRate, active } = req.body;

    // Check if restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check if user has access to update this restaurant
    if (
      req.user.role !== 'ADMIN' &&
      (req.user.role !== 'MANAGER' || restaurant.id !== req.user.restaurantId)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this restaurant'
      });
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (taxRate !== undefined) updateData.taxRate = taxRate;
    
    // Only admin can change active status
    if (active !== undefined && req.user.role === 'ADMIN') {
      updateData.active = active;
    }

    // Update restaurant
    const updatedRestaurant = await prisma.restaurant.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({
      success: true,
      data: updatedRestaurant
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a restaurant
 * @route   DELETE /api/restaurants/:id
 * @access  Private/Admin
 */
exports.deleteRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id },
      include: {
        users: true,
        tables: true,
        menuItems: true,
        orders: true,
        categories: true
      }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check if restaurant has associated data
    if (
      restaurant.users.length > 0 ||
      restaurant.tables.length > 0 ||
      restaurant.menuItems.length > 0 ||
      restaurant.orders.length > 0 ||
      restaurant.categories.length > 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete restaurant with associated data. Deactivate it instead.'
      });
    }

    // Delete restaurant
    await prisma.restaurant.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Restaurant deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get restaurant statistics
 * @route   GET /api/restaurants/:id/stats
 * @access  Private/Admin/Manager
 */
exports.getRestaurantStats = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { period = 'today' } = req.query;

    // Check if restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      restaurant.id !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this restaurant'
      });
    }

    // Set date range based on period
    let startDate, endDate = new Date();
    const today = new Date();
    
    switch(period) {
      case 'today':
        startDate = new Date(today.setHours(0, 0, 0, 0));
        break;
      case 'yesterday':
        startDate = new Date(today.setDate(today.getDate() - 1));
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(today.setHours(23, 59, 59, 999));
        break;
      case 'week':
        startDate = new Date(today.setDate(today.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(today.setMonth(today.getMonth() - 1));
        break;
      default:
        startDate = new Date(today.setHours(0, 0, 0, 0));
    }

    // Get sales statistics
    const completedOrders = await prisma.order.findMany({
      where: {
        restaurantId: id,
        status: 'COMPLETED',
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      select: {
        id: true,
        total: true,
        subtotal: true,
        tax: true,
        createdAt: true
      }
    });

    const totalSales = completedOrders.reduce((sum, order) => sum + order.total, 0);
    const orderCount = completedOrders.length;
    const averageOrderValue = orderCount > 0 ? totalSales / orderCount : 0;

    // Get active tables count
    const tablesCount = await prisma.table.count({
      where: {
        restaurantId: id
      }
    });

    const occupiedTablesCount = await prisma.table.count({
      where: {
        restaurantId: id,
        status: 'OCCUPIED'
      }
    });

    // Get active orders
    const activeOrders = await prisma.order.count({
      where: {
        restaurantId: id,
        status: {
          in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
        }
      }
    });

    // Get top selling items
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          restaurantId: id,
          status: 'COMPLETED',
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true
          }
        }
      }
    });

    const itemSales = {};
    orderItems.forEach(item => {
      const menuItemId = item.menuItem?.id;
      if (!menuItemId) return;
      
      if (!itemSales[menuItemId]) {
        itemSales[menuItemId] = {
          id: menuItemId,
          name: item.menuItem.name,
          quantity: 0,
          revenue: 0
        };
      }
      
      itemSales[menuItemId].quantity += item.quantity;
      itemSales[menuItemId].revenue += item.price * item.quantity;
    });

    const topSellingItems = Object.values(itemSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    res.status(200).json({
      success: true,
      data: {
        period,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        sales: {
          total: totalSales,
          orderCount,
          averageOrderValue
        },
        tables: {
          total: tablesCount,
          occupied: occupiedTablesCount,
          occupancyRate: tablesCount > 0 ? occupiedTablesCount / tablesCount : 0
        },
        activeOrders,
        topSellingItems
      }
    });
  } catch (error) {
    next(error);
  }
};