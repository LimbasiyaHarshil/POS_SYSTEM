const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all inventory items
 * @route   GET /api/inventory
 * @access  Private/Manager/Admin
 */
exports.getInventoryItems = async (req, res, next) => {
  try {
    const { search, lowStock } = req.query;
    
    // Build filter condition
    const where = {};
    
    // Search by name or description
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Filter low stock items (items below reorder level)
    if (lowStock === 'true') {
      where.quantity = {
        lt: prisma.inventoryItem.fields.reorderLevel
      };
    }

    // Get inventory items
    const inventoryItems = await prisma.inventoryItem.findMany({
      where,
      include: {
        inventoryUsages: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    // Mark items as low stock for easier frontend handling
    const itemsWithStatus = inventoryItems.map(item => ({
      ...item,
      isLowStock: item.reorderLevel !== null && item.quantity < item.reorderLevel
    }));

    res.status(200).json({
      success: true,
      count: itemsWithStatus.length,
      data: itemsWithStatus
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single inventory item
 * @route   GET /api/inventory/:id
 * @access  Private/Manager/Admin
 */
exports.getInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        inventoryUsages: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                restaurantId: true
              }
            }
          }
        }
      }
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // Add low stock flag
    const itemWithStatus = {
      ...inventoryItem,
      isLowStock: 
        inventoryItem.reorderLevel !== null && 
        inventoryItem.quantity < inventoryItem.reorderLevel
    };

    res.status(200).json({
      success: true,
      data: itemWithStatus
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create an inventory item
 * @route   POST /api/inventory
 * @access  Private/Manager/Admin
 */
exports.createInventoryItem = async (req, res, next) => {
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
      unitType, 
      quantity, 
      reorderLevel, 
      cost 
    } = req.body;

    // Check if item with same name already exists
    const existingItem = await prisma.inventoryItem.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive'
        }
      }
    });

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: 'An inventory item with this name already exists'
      });
    }

    // Create inventory item
    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        name,
        description,
        unitType,
        quantity,
        reorderLevel,
        cost
      }
    });

    res.status(201).json({
      success: true,
      data: inventoryItem
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an inventory item
 * @route   PUT /api/inventory/:id
 * @access  Private/Manager/Admin
 */
exports.updateInventoryItem = async (req, res, next) => {
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
      unitType, 
      quantity, 
      reorderLevel, 
      cost 
    } = req.body;

    // Check if inventory item exists
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id }
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // If name is changing, check if new name is already taken
    if (name && name !== inventoryItem.name) {
      const existingItem = await prisma.inventoryItem.findFirst({
        where: {
          name: {
            equals: name,
            mode: 'insensitive'
          },
          NOT: {
            id
          }
        }
      });

      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: 'Another inventory item with this name already exists'
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (unitType !== undefined) updateData.unitType = unitType;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (reorderLevel !== undefined) updateData.reorderLevel = reorderLevel;
    if (cost !== undefined) updateData.cost = cost;

    // Update inventory item
    const updatedItem = await prisma.inventoryItem.update({
      where: { id },
      data: updateData
    });

    // Check if item is low on stock after update
    const isLowStock = 
      updatedItem.reorderLevel !== null && 
      updatedItem.quantity < updatedItem.reorderLevel;

    // Add warning to response if stock is low
    if (isLowStock) {
      res.status(200).json({
        success: true,
        data: {
          ...updatedItem,
          isLowStock: true
        },
        warning: `"${updatedItem.name}" is below the reorder level of ${updatedItem.reorderLevel}${updatedItem.unitType}`
      });
    } else {
      res.status(200).json({
        success: true,
        data: {
          ...updatedItem,
          isLowStock: false
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete an inventory item
 * @route   DELETE /api/inventory/:id
 * @access  Private/Manager/Admin
 */
exports.deleteInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if inventory item exists
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        inventoryUsages: true
      }
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // Check if inventory item is used in any menu items
    if (inventoryItem.inventoryUsages.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete inventory item that is used in menu items'
      });
    }

    // Delete inventory item
    await prisma.inventoryItem.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Inventory item deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Adjust inventory quantity
 * @route   POST /api/inventory/:id/adjust
 * @access  Private/Manager/Admin
 */
exports.adjustInventory = async (req, res, next) => {
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

    // Check if inventory item exists
    const inventoryItem = await prisma.inventoryItem.findUnique({
      where: { id }
    });

    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    // Calculate new quantity
    const newQuantity = inventoryItem.quantity + adjustment;

    // Don't allow negative inventory
    if (newQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment would result in negative inventory'
      });
    }

    // Update inventory item
    const updatedItem = await prisma.inventoryItem.update({
      where: { id },
      data: {
        quantity: newQuantity
      }
    });

    // Log the adjustment (in a real system, would likely use a separate table)
    console.log(`Inventory adjustment: ${inventoryItem.name}, ${adjustment}${inventoryItem.unitType}, reason: ${reason}`);

    // Check if item is now low on stock
    const isLowStock = 
      updatedItem.reorderLevel !== null && 
      updatedItem.quantity < updatedItem.reorderLevel;

    if (isLowStock) {
      res.status(200).json({
        success: true,
        data: {
          ...updatedItem,
          isLowStock: true
        },
        warning: `"${updatedItem.name}" is below the reorder level of ${updatedItem.reorderLevel}${updatedItem.unitType}`
      });
    } else {
      res.status(200).json({
        success: true,
        data: {
          ...updatedItem,
          isLowStock: false
        }
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get low stock items
 * @route   GET /api/inventory/low-stock
 * @access  Private/Manager/Admin
 */
exports.getLowStockItems = async (req, res, next) => {
  try {
    // Get inventory items where quantity is below reorder level
    const lowStockItems = await prisma.inventoryItem.findMany({
      where: {
        reorderLevel: { not: null },
        quantity: {
          lt: prisma.inventoryItem.fields.reorderLevel
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: lowStockItems.length,
      data: lowStockItems.map(item => ({
        ...item,
        isLowStock: true
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get inventory usage for a menu item
 * @route   GET /api/inventory/usage/:menuItemId
 * @access  Private/Manager/Admin
 */
exports.getMenuItemInventoryUsage = async (req, res, next) => {
  try {
    const { menuItemId } = req.params;

    // Check if menu item exists
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId }
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

    // Get inventory usage for this menu item
    const inventoryUsage = await prisma.inventoryUsage.findMany({
      where: { menuItemId },
      include: {
        inventoryItem: true
      }
    });

    res.status(200).json({
      success: true,
      count: inventoryUsage.length,
      data: inventoryUsage
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update inventory usage for a menu item
 * @route   PUT /api/inventory/usage/:menuItemId
 * @access  Private/Manager/Admin
 */
exports.updateMenuItemInventoryUsage = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { menuItemId } = req.params;
    const { inventoryUsages } = req.body;

    // Check if menu item exists
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId }
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

// Check if inventory usages are valid
    if (!inventoryUsages || !Array.isArray(inventoryUsages)) {
      return res.status(400).json({
        success: false,
        message: 'Inventory usages must be an array'
      });
    }

    // Delete existing inventory usages
    await prisma.inventoryUsage.deleteMany({
      where: { menuItemId }
    });

    // Create new inventory usages
    const newInventoryUsages = [];
    for (const usage of inventoryUsages) {
      const { inventoryItemId, quantity } = usage;

      // Check if inventory item exists
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId }
      });

      if (!inventoryItem) {
        return res.status(404).json({
          success: false,
          message: `Inventory item with ID ${inventoryItemId} not found`
        });
      }

      // Create inventory usage
      const newUsage = await prisma.inventoryUsage.create({
        data: {
          menuItem: {
            connect: { id: menuItemId }
          },
          inventoryItem: {
            connect: { id: inventoryItemId }
          },
          quantity
        },
        include: {
          inventoryItem: true
        }
      });

      newInventoryUsages.push(newUsage);
    }

    res.status(200).json({
      success: true,
      count: newInventoryUsages.length,
      data: newInventoryUsages
    });
  } catch (error) {
    next(error);
  }
};