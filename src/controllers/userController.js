const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all users
 * @route   GET /api/users
 * @access  Private/Admin
 */
exports.getUsers = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;
    
    // Build filter condition
    const where = {};
    if (restaurantId) {
      where.restaurantId = restaurantId;
    }
    
    // For non-admin users, limit to their restaurant only
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }
    
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        restaurantId: true,
        profileImage: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user by id
 * @route   GET /api/users/:id
 * @access  Private/Admin or Same User
 */
exports.getUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if user has rights to access this user
    if (req.user.role !== 'ADMIN' && req.user.id !== id) {
      if (req.user.role !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this user'
        });
      }
      
      // Manager can only access users in their restaurant
      const requestedUser = await prisma.user.findUnique({
        where: { id },
        select: { restaurantId: true }
      });
      
      if (!requestedUser || requestedUser.restaurantId !== req.user.restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this user'
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        restaurantId: true,
        profileImage: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a user
 * @route   POST /api/users
 * @access  Private/Admin or Manager
 */
exports.createUser = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    let { email, password, firstName, lastName, role, restaurantId, active } = req.body;

    // Manager can only create users for their restaurant
    if (req.user.role === 'MANAGER') {
      restaurantId = req.user.restaurantId;
      
      // Managers cannot create admin users
      if (role === 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Managers cannot create admin users'
        });
      }
    }

    // Check if user already exists
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User with that email already exists'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        role: role || 'SERVER',
        active: active !== undefined ? active : true,
        restaurant: restaurantId ? {
          connect: { id: restaurantId }
        } : undefined
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        restaurantId: true
      }
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a user
 * @route   PUT /api/users/:id
 * @access  Private/Admin or Same User or Manager
 */
exports.updateUser = async (req, res, next) => {
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
    const { firstName, lastName, email, role, active, restaurantId } = req.body;

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check authorization
    if (req.user.role !== 'ADMIN') {
      // Self-update checks
      if (req.user.id === id) {
        // Users can only update their own name, email
        if (role || active !== undefined || restaurantId) {
          return res.status(403).json({
            success: false,
            message: 'You can only update your name and email'
          });
        }
      } 
      // Manager checks
      else if (req.user.role === 'MANAGER') {
        // Manager can only update users in their restaurant
        if (existingUser.restaurantId !== req.user.restaurantId) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to update this user'
          });
        }
        
        // Manager cannot update other managers or admins
        if (existingUser.role === 'ADMIN' || existingUser.role === 'MANAGER') {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to update users with this role'
          });
        }
        
        // Manager cannot change user to admin
        if (role === 'ADMIN') {
          return res.status(403).json({
            success: false,
            message: 'Managers cannot assign admin role'
          });
        }
      } 
      // All other cases are unauthorized
      else {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this user'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (active !== undefined) updateData.active = active;

    // Handle restaurant relationship
    if (restaurantId) {
      updateData.restaurant = {
        connect: { id: restaurantId }
      };
    } else if (restaurantId === null) {
      updateData.restaurant = {
        disconnect: true
      };
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        restaurantId: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.status(200).json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a user
 * @route   DELETE /api/users/:id
 * @access  Private/Admin or Manager
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get existing user
    const existingUser = await prisma.user.findUnique({
      where: { id }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check authorization
    if (req.user.role !== 'ADMIN') {
      if (req.user.role !== 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete users'
        });
      }
      
      // Manager can only delete users in their restaurant
      if (existingUser.restaurantId !== req.user.restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this user'
        });
      }
      
      // Manager cannot delete other managers or admins
      if (existingUser.role === 'ADMIN' || existingUser.role === 'MANAGER') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete users with this role'
        });
      }
    }
    
    // Cannot delete yourself
    if (req.user.id === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    // Delete user
    await prisma.user.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};