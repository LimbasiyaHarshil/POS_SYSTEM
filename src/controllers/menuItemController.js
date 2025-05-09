const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all menu items
 * @route   GET /api/menu/items
 * @access  Private
 */
exports.getMenuItems = async (req, res, next) => {
  try {
    const { restaurantId, categoryId, available, search } = req.query;

    // Build filter condition
    const where = {};
    
    // Filter by restaurant
    if (restaurantId) {
      where.restaurantId = restaurantId;
    } else if (req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }

    // Filter by category
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Filter by availability
    if (available === 'true') {
      where.available = true;
    } else if (available === 'false') {
      where.available = false;
    }

    // Search by name
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const menuItems = await prisma.menuItem.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        },
        modifierGroups: {
          include: {
            modifiers: true
          }
        },
        inventoryUsages: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                quantity: true,
                unitType: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: menuItems.length,
      data: menuItems
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single menu item
 * @route   GET /api/menu/items/:id
 * @access  Private
 */
exports.getMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const menuItem = await prisma.menuItem.findUnique({
      where: { id },
      include: {
        category: true,
        modifierGroups: {
          include: {
            modifiers: true
          }
        },
        inventoryUsages: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                quantity: true,
                unitType: true
              }
            }
          }
        }
      }
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      menuItem.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this menu item'
      });
    }

    res.status(200).json({
      success: true,
      data: menuItem
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a menu item
 * @route   POST /api/menu/items
 * @access  Private/Manager/Admin
 */
exports.createMenuItem = async (req, res, next) => {
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
      name, 
      description, 
      price, 
      cost, 
      image, 
      available, 
      preparationTime,
      categoryId,
      inventoryUsages,
      modifierGroups
    } = req.body;
    
    let { restaurantId } = req.body;

    // If not admin, can only create for own restaurant
    if (req.user.role !== 'ADMIN') {
      restaurantId = req.user.restaurantId;
    }

    // Check restaurant exists
    if (restaurantId) {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId }
      });

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message: 'Restaurant not found'
        });
      }
    }

    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Category must be in the same restaurant
    if (category.restaurantId !== restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'Category must be in the same restaurant'
      });
    }

    // Create menu item
    const menuItem = await prisma.menuItem.create({
      data: {
        name,
        description,
        price,
        cost,
        image,
        available: available !== undefined ? available : true,
        preparationTime,
        category: {
          connect: { id: categoryId }
        },
        restaurant: {
          connect: { id: restaurantId }
        }
      }
    });

    // Process inventory usage if provided
    if (inventoryUsages && inventoryUsages.length > 0) {
      await Promise.all(
        inventoryUsages.map(async (usage) => {
          // Check if inventory item exists
          const inventoryItem = await prisma.inventoryItem.findUnique({
            where: { id: usage.inventoryItemId }
          });

          if (!inventoryItem) {
            throw new Error(`Inventory item with ID ${usage.inventoryItemId} not found`);
          }

          // Create inventory usage
          return prisma.inventoryUsage.create({
            data: {
              quantity: usage.quantity,
              menuItem: {
                connect: { id: menuItem.id }
              },
              inventoryItem: {
                connect: { id: usage.inventoryItemId }
              }
            }
          });
        })
      );
    }

    // Process modifier groups if provided
    if (modifierGroups && modifierGroups.length > 0) {
      await Promise.all(
        modifierGroups.map(async (group) => {
          // Check if group exists
          let modifierGroup;
          
          if (group.id) {
            modifierGroup = await prisma.modifierGroup.findUnique({
              where: { id: group.id }
            });
            
            if (!modifierGroup) {
              throw new Error(`Modifier group with ID ${group.id} not found`);
            }
            
            // Connect existing modifier group to menu item
            await prisma.modifierGroup.update({
              where: { id: group.id },
              data: {
                menuItems: {
                  connect: { id: menuItem.id }
                }
              }
            });
          } else if (group.name) {
            // Create new modifier group
            modifierGroup = await prisma.modifierGroup.create({
              data: {
                name: group.name,
                required: group.required || false,
                multiSelect: group.multiSelect || false,
                menuItems: {
                  connect: { id: menuItem.id }
                }
              }
            });
            
            // Create modifiers if provided
            if (group.modifiers && group.modifiers.length > 0) {
              await Promise.all(
                group.modifiers.map((modifier) => 
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
          }
        })
      );
    }

    // Return the created menu item with all its relations
    const createdMenuItem = await prisma.menuItem.findUnique({
      where: { id: menuItem.id },
      include: {
        category: true,
        modifierGroups: {
          include: {
            modifiers: true
          }
        },
        inventoryUsages: {
          include: {
            inventoryItem: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: createdMenuItem
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a menu item
 * @route   PUT /api/menu/items/:id
 * @access  Private/Manager/Admin
 */
exports.updateMenuItem = async (req, res, next) => {
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
      name, 
      description, 
      price, 
      cost, 
      image, 
      available, 
      preparationTime, 
      categoryId,
      inventoryUsages
    } = req.body;

    // Check if menu item exists
    const menuItem = await prisma.menuItem.findUnique({
      where: { id }
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      menuItem.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this menu item'
      });
    }

    // Check if category exists if changing
    if (categoryId && categoryId !== menuItem.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: categoryId }
      });

      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Category must be in the same restaurant
      if (category.restaurantId !== menuItem.restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Category must be in the same restaurant'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (cost !== undefined) updateData.cost = cost;
    if (image !== undefined) updateData.image = image;
    if (available !== undefined) updateData.available = available;
    if (preparationTime !== undefined) updateData.preparationTime = preparationTime;

    // Handle category relationship
    if (categoryId) {
      updateData.category = {
        connect: { id: categoryId }
      };
    }

    // Update menu item
    const updatedMenuItem = await prisma.menuItem.update({
      where: { id },
      data: updateData
    });

    // Update inventory usage if provided
    if (inventoryUsages && inventoryUsages.length > 0) {
      // First remove all existing inventory usages
      await prisma.inventoryUsage.deleteMany({
        where: { menuItemId: id }
      });

      // Then create new ones
      await Promise.all(
        inventoryUsages.map(async (usage) => {
          // Check if inventory item exists
          const inventoryItem = await prisma.inventoryItem.findUnique({
            where: { id: usage.inventoryItemId }
          });

          if (!inventoryItem) {
            throw new Error(`Inventory item with ID ${usage.inventoryItemId} not found`);
          }

          // Create inventory usage
          return prisma.inventoryUsage.create({
            data: {
              quantity: usage.quantity,
              menuItem: {
                connect: { id: id }
              },
              inventoryItem: {
                connect: { id: usage.inventoryItemId }
              }
            }
          });
        })
      );
    }

    // Get updated menu item with relations
    const finalMenuItem = await prisma.menuItem.findUnique({
      where: { id },
      include: {
        category: true,
        modifierGroups: {
          include: {
            modifiers: true
          }
        },
        inventoryUsages: {
          include: {
            inventoryItem: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: finalMenuItem
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a menu item
 * @route   DELETE /api/menu/items/:id
 * @access  Private/Manager/Admin
 */
exports.deleteMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if menu item exists
    const menuItem = await prisma.menuItem.findUnique({
      where: { id },
      include: {
        orderItems: true
      }
    });

    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      menuItem.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this menu item'
      });
    }

    // Check if menu item has been ordered
    if (menuItem.orderItems.length > 0) {
      // Instead of deleting, just mark as unavailable
      await prisma.menuItem.update({
        where: { id },
        data: { available: false }
      });

      return res.status(200).json({
        success: true,
        message: 'Menu item has order history, marked as unavailable instead of deleting'
      });
    }

    // Delete all inventory usages for this menu item
    await prisma.inventoryUsage.deleteMany({
      where: { menuItemId: id }
    });

    // Remove associations with modifier groups
    await prisma.modifierGroup.updateMany({
      where: {
        menuItems: {
          some: { id }
        }
      },
      data: {
        menuItems: {
          disconnect: { id }
        }
      }
    });

    // Delete menu item
    await prisma.menuItem.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};