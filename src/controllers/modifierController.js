const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all modifier groups
 * @route   GET /api/menu/modifier-groups
 * @access  Private
 */
exports.getModifierGroups = async (req, res, next) => {
  try {
    const { menuItemId } = req.query;

    // Build filter condition
    let where = {};
    
    // Filter by menu item
    if (menuItemId) {
      where = {
        menuItems: {
          some: { id: menuItemId }
        }
      };
    }

    const modifierGroups = await prisma.modifierGroup.findMany({
      where,
      include: {
        modifiers: true,
        menuItems: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: modifierGroups.length,
      data: modifierGroups
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single modifier group
 * @route   GET /api/menu/modifier-groups/:id
 * @access  Private
 */
exports.getModifierGroup = async (req, res, next) => {
  try {
    const { id } = req.params;

    const modifierGroup = await prisma.modifierGroup.findUnique({
      where: { id },
      include: {
        modifiers: true,
        menuItems: {
          select: {
            id: true,
            name: true,
            restaurantId: true
          }
        }
      }
    });

    if (!modifierGroup) {
      return res.status(404).json({
        success: false,
        message: 'Modifier group not found'
      });
    }

    // Check if user has access to this data
    // We need to check through the menuItems to see if any are from the user's restaurant
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this modifier group'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: modifierGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a modifier group
 * @route   POST /api/menu/modifier-groups
 * @access  Private/Manager/Admin
 */
exports.createModifierGroup = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, required, multiSelect, menuItemIds, modifiers } = req.body;

    // Create modifier group
    const modifierGroup = await prisma.modifierGroup.create({
      data: {
        name,
        required: required || false,
        multiSelect: multiSelect || false,
        menuItems: menuItemIds ? {
          connect: menuItemIds.map(id => ({ id }))
        } : undefined
      }
    });

    // Add modifiers if provided
    if (modifiers && modifiers.length > 0) {
      await Promise.all(
        modifiers.map((modifier) =>
          prisma.modifier.create({
            data: {
              name: modifier.name,
              price: modifier.price || 0,
              available: modifier.available !== undefined ? modifier.available : true,
              modifierGroup: {
                connect: { id: modifierGroup.id }
              }
            }
          })
        )
      );
    }

    // Return the created group with modifiers
    const createdGroup = await prisma.modifierGroup.findUnique({
      where: { id: modifierGroup.id },
      include: {
        modifiers: true,
        menuItems: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: createdGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a modifier group
 * @route   PUT /api/menu/modifier-groups/:id
 * @access  Private/Manager/Admin
 */
exports.updateModifierGroup = async (req, res, next) => {
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
    const { name, required, multiSelect, menuItemIds } = req.body;

    // Check if modifier group exists
    const modifierGroup = await prisma.modifierGroup.findUnique({
      where: { id },
      include: {
        menuItems: {
          select: {
            id: true,
            name: true,
            restaurantId: true
          }
        }
      }
    });

    if (!modifierGroup) {
      return res.status(404).json({
        success: false,
        message: 'Modifier group not found'
      });
    }

    // Check if user has access to update this modifier group
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this modifier group'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (required !== undefined) updateData.required = required;
    if (multiSelect !== undefined) updateData.multiSelect = multiSelect;

    // Handle menu items relationship
    if (menuItemIds) {
      // Check if user has access to all the menu items
      if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
        const menuItems = await prisma.menuItem.findMany({
          where: { id: { in: menuItemIds } },
          select: { id: true, restaurantId: true }
        });
        
        const hasAccessToAll = menuItems.every(
          item => item.restaurantId === req.user.restaurantId
        );
        
        if (!hasAccessToAll) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to assign menu items from other restaurants'
          });
        }
      }

      // First disconnect all existing menu items
      updateData.menuItems = {
        set: []
      };
      
      // Then connect the new ones
      updateData.menuItems = {
        connect: menuItemIds.map(id => ({ id }))
      };
    }

    // Update modifier group
    const updatedGroup = await prisma.modifierGroup.update({
      where: { id },
      data: updateData,
      include: {
        modifiers: true,
        menuItems: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: updatedGroup
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a modifier group
 * @route   DELETE /api/menu/modifier-groups/:id
 * @access  Private/Manager/Admin
 */
exports.deleteModifierGroup = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if modifier group exists
    const modifierGroup = await prisma.modifierGroup.findUnique({
      where: { id },
      include: {
        menuItems: {
          select: {
            id: true,
            name: true,
            restaurantId: true
          }
        },
        modifiers: {
          include: {
            orderItemModifiers: true
          }
        }
      }
    });

    if (!modifierGroup) {
      return res.status(404).json({
        success: false,
        message: 'Modifier group not found'
      });
    }

    // Check if user has access to delete this modifier group
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this modifier group'
        });
      }
    }

    // Check if any modifiers in this group have been used in orders
    const hasOrderHistory = modifierGroup.modifiers.some(
      modifier => modifier.orderItemModifiers.length > 0
    );

    if (hasOrderHistory) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete modifier group that has been used in orders'
      });
    }

    // Delete all modifiers in this group
    await prisma.modifier.deleteMany({
      where: { modifierGroupId: id }
    });

    // Delete modifier group
    await prisma.modifierGroup.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Modifier group deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all modifiers
 * @route   GET /api/menu/modifiers
 * @access  Private
 */
exports.getModifiers = async (req, res, next) => {
  try {
    const { groupId } = req.query;

    // Build filter condition
    const where = {};
    
    // Filter by group
    if (groupId) {
      where.modifierGroupId = groupId;
    }

    const modifiers = await prisma.modifier.findMany({
      where,
      include: {
        modifierGroup: true
      },
      orderBy: [
        {
          modifierGroupId: 'asc'
        },
        {
          name: 'asc'
        }
      ]
    });

    res.status(200).json({
      success: true,
      count: modifiers.length,
      data: modifiers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a modifier
 * @route   POST /api/menu/modifiers
 * @access  Private/Manager/Admin
 */
exports.createModifier = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, price, available, modifierGroupId } = req.body;

    // Check if modifier group exists
    const modifierGroup = await prisma.modifierGroup.findUnique({
      where: { id: modifierGroupId },
      include: {
        menuItems: {
          select: {
            restaurantId: true
          }
        }
      }
    });

    if (!modifierGroup) {
      return res.status(404).json({
        success: false,
        message: 'Modifier group not found'
      });
    }

    // Check if user has access to this modifier group
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to add modifiers to this group'
        });
      }
    }

    // Create modifier
    const modifier = await prisma.modifier.create({
      data: {
        name,
        price: price || 0,
        available: available !== undefined ? available : true,
        modifierGroup: {
          connect: { id: modifierGroupId }
        }
      },
      include: {
        modifierGroup: true
      }
    });

    res.status(201).json({
      success: true,
      data: modifier
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a modifier
 * @route   PUT /api/menu/modifiers/:id
 * @access  Private/Manager/Admin
 */
exports.updateModifier = async (req, res, next) => {
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
    const { name, price, available } = req.body;

    // Check if modifier exists
    const modifier = await prisma.modifier.findUnique({
      where: { id },
      include: {
        modifierGroup: {
          include: {
            menuItems: {
              select: {
                restaurantId: true
              }
            }
          }
        }
      }
    });

    if (!modifier) {
      return res.status(404).json({
        success: false,
        message: 'Modifier not found'
      });
    }

    // Check if user has access to update this modifier
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifier.modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this modifier'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (available !== undefined) updateData.available = available;

    // Update modifier
    const updatedModifier = await prisma.modifier.update({
      where: { id },
      data: updateData,
      include: {
        modifierGroup: true
      }
    });

    res.status(200).json({
      success: true,
      data: updatedModifier
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a modifier
 * @route   DELETE /api/menu/modifiers/:id
 * @access  Private/Manager/Admin
 */
exports.deleteModifier = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if modifier exists
    const modifier = await prisma.modifier.findUnique({
      where: { id },
      include: {
        modifierGroup: {
          include: {
            menuItems: {
              select: {
                restaurantId: true
              }
            }
          }
        },
        orderItemModifiers: true
      }
    });

    if (!modifier) {
      return res.status(404).json({
        success: false,
        message: 'Modifier not found'
      });
    }

    // Check if user has access to delete this modifier
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      const hasAccess = modifier.modifierGroup.menuItems.some(
        item => item.restaurantId === req.user.restaurantId
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this modifier'
        });
      }
    }

    // Check if modifier has been used in orders
    if (modifier.orderItemModifiers.length > 0) {
      // Instead of deleting, just mark as unavailable
      await prisma.modifier.update({
        where: { id },
        data: { available: false }
      });

      return res.status(200).json({
        success: true,
        message: 'Modifier has order history, marked as unavailable instead of deleting'
      });
    }

    // Delete modifier
    await prisma.modifier.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Modifier deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};