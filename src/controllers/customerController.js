const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all customers
 * @route   GET /api/customers
 * @access  Private
 */
exports.getCustomers = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter condition
    const where = {};
    
    // Search by name, email, or phone
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } }
      ];
    }
    
    // Get customers count for pagination
    const totalCustomers = await prisma.customer.count({
      where
    });

    // Get customers with pagination
    const customers = await prisma.customer.findMany({
      where,
      orderBy: {
        lastName: 'asc'
      },
      skip,
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: customers.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCustomers,
        pages: Math.ceil(totalCustomers / parseInt(limit))
      },
      data: customers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single customer
 * @route   GET /api/customers/:id
 * @access  Private
 */
exports.getCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    res.status(200).json({
      success: true,
      data: customer
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a customer
 * @route   POST /api/customers
 * @access  Private
 */
exports.createCustomer = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      birthdate,
      loyaltyPoints 
    } = req.body;

    // Check if customer with this email already exists
    if (email) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { email }
      });

      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this email already exists'
        });
      }
    }

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName,
        email,
        phone,
        birthdate: birthdate ? new Date(birthdate) : null,
        loyaltyPoints: loyaltyPoints || 0
      }
    });

    res.status(201).json({
      success: true,
      data: customer
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a customer
 * @route   PUT /api/customers/:id
 * @access  Private
 */
exports.updateCustomer = async (req, res, next) => {
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
    const { 
      firstName, 
      lastName, 
      email, 
      phone, 
      birthdate,
      loyaltyPoints 
    } = req.body;

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if email is being changed and already exists
    if (email && email !== customer.email) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { email }
      });

      if (existingCustomer) {
        return res.status(400).json({
          success: false,
          message: 'Another customer with this email already exists'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (birthdate !== undefined) updateData.birthdate = birthdate ? new Date(birthdate) : null;
    if (loyaltyPoints !== undefined) updateData.loyaltyPoints = loyaltyPoints;

    // Update customer
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    res.status(200).json({
      success: true,
      data: updatedCustomer
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a customer
 * @route   DELETE /api/customers/:id
 * @access  Private/Manager/Admin
 */
exports.deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: true
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if customer has orders
    if (customer.orders.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with order history'
      });
    }

    // Delete customer
    await prisma.customer.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get customer order history
 * @route   GET /api/customers/:id/orders
 * @access  Private
 */
exports.getCustomerOrders = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Build where clause for orders
    const where = { customerId: id };
    
    // If not admin, limit to user's restaurant
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }
    
    // Get orders count for pagination
    const totalOrders = await prisma.order.count({
      where
    });

    // Get customer orders with pagination
    const orders = await prisma.order.findMany({
      where,
      include: {
        restaurant: {
          select: {
            id: true,
            name: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                price: true
              }
            }
          }
        },
        payments: {
          where: {
            status: 'COMPLETED'
          },
          select: {
            id: true,
            amount: true,
            method: true,
            createdAt: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: orders.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalOrders,
        pages: Math.ceil(totalOrders / parseInt(limit))
      },
      data: orders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Adjust customer loyalty points
 * @route   PUT /api/customers/:id/loyalty-points
 * @access  Private/Manager/Admin
 */
exports.adjustLoyaltyPoints = async (req, res, next) => {
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
    const { adjustment, reason } = req.body;

    // Check if customer exists
    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Calculate new points
    const newPoints = customer.loyaltyPoints + adjustment;
    
    // Don't allow negative points
    if (newPoints < 0) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment would result in negative loyalty points'
      });
    }

    // Update customer loyalty points
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        loyaltyPoints: newPoints
      }
    });

    // Log the adjustment (in a real system, would likely use a separate table)
    console.log(`Loyalty points adjustment for customer ${id}: ${adjustment}, reason: ${reason}`);

    res.status(200).json({
      success: true,
      data: updatedCustomer,
      message: `Loyalty points ${adjustment > 0 ? 'added' : 'deducted'} successfully`
    });
  } catch (error) {
    next(error);
  }
};