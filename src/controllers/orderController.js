const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all orders
 * @route   GET /api/orders
 * @access  Private
 */
exports.getOrders = async (req, res, next) => {
  try {
    const { 
      restaurantId, 
      status, 
      type, 
      tableId, 
      userId,
      customerId,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
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

    // Filter by type
    if (type) {
      where.type = type;
    }

    // Filter by table
    if (tableId) {
      where.tableId = tableId;
    }

    // Filter by user
    if (userId) {
      where.userId = userId;
    }

    // Filter by customer
    if (customerId) {
      where.customerId = customerId;
    }

    // Filter by date range
    if (startDate || endDate) {
      where.createdAt = {};
      
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }
    
    // Get orders count for pagination
    const totalOrders = await prisma.order.count({ where });
    
    // Get orders with pagination
    const orders = await prisma.order.findMany({
      where,
      include: {
        table: {
          select: {
            id: true,
            number: true
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true
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
            },
            modifiers: {
              include: {
                modifier: true
              }
            }
          }
        },
        payments: {
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
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
 * @desc    Get a single order
 * @route   GET /api/orders/:id
 * @access  Private
 */
exports.getOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        customer: true,
        orderItems: {
          include: {
            menuItem: true,
            modifiers: {
              include: {
                modifier: true
              }
            }
          }
        },
        payments: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this order'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new order
 * @route   POST /api/orders
 * @access  Private
 */
exports.createOrder = async (req, res, next) => {
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
      tableId, 
      customerId, 
      type, 
      orderItems,
      notes
    } = req.body;
    
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

    // Check table exists and belongs to the restaurant
    if (tableId) {
      const table = await prisma.table.findUnique({
        where: { id: tableId }
      });

      if (!table) {
        return res.status(404).json({
          success: false,
          message: 'Table not found'
        });
      }

      if (table.restaurantId !== restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Table must belong to the same restaurant'
        });
      }

      // Update table status to occupied if it's currently available
      if (table.status === 'AVAILABLE') {
        await prisma.table.update({
          where: { id: tableId },
          data: { status: 'OCCUPIED' }
        });
      }
    }

    // Check customer exists
    if (customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId }
      });

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }
    }

    // Validate order items
    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must have at least one item'
      });
    }

    // Calculate order totals and validate items
    let subtotal = 0;
    const validatedItems = [];

    for (const item of orderItems) {
      const { menuItemId, quantity, modifierIds, notes: itemNotes } = item;

      // Check menu item exists and belongs to the restaurant
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: menuItemId },
        include: {
          modifierGroups: {
            include: {
              modifiers: true
            }
          }
        }
      });

      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: `Menu item with ID ${menuItemId} not found`
        });
      }

      if (menuItem.restaurantId !== restaurantId) {
        return res.status(400).json({
          success: false,
          message: `Menu item with ID ${menuItemId} does not belong to this restaurant`
        });
      }

      if (!menuItem.available) {
        return res.status(400).json({
          success: false,
          message: `Menu item "${menuItem.name}" is not available`
        });
      }

      // Process modifiers if present
      let modifiersPrice = 0;
      const validatedModifiers = [];

      if (modifierIds && modifierIds.length > 0) {
        for (const modifierId of modifierIds) {
          // Find modifier in menu item's available modifiers
          let modifierFound = false;
          let modifier = null;

          for (const group of menuItem.modifierGroups) {
            modifier = group.modifiers.find(m => m.id === modifierId);
            if (modifier) {
              modifierFound = true;
              break;
            }
          }

          if (!modifierFound) {
            return res.status(400).json({
              success: false,
              message: `Modifier with ID ${modifierId} is not valid for menu item "${menuItem.name}"`
            });
          }

          if (!modifier.available) {
            return res.status(400).json({
              success: false,
              message: `Modifier "${modifier.name}" is not available`
            });
          }

          modifiersPrice += modifier.price;
          validatedModifiers.push({
            modifierId,
            price: modifier.price
          });
        }
      }

      const itemTotal = (menuItem.price + modifiersPrice) * quantity;
      subtotal += itemTotal;

      validatedItems.push({
        menuItemId,
        quantity,
        price: menuItem.price,
        notes: itemNotes,
        modifiers: validatedModifiers
      });
    }

    // Calculate tax
    const taxRate = restaurant.taxRate || 0;
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    // Generate order number
    const orderCount = await prisma.order.count({
      where: { restaurantId }
    });
    const orderNumber = `${restaurantId.substr(0, 4)}-${new Date().getFullYear()}${new Date().getMonth() + 1}${new Date().getDate()}-${orderCount + 1}`;

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        status: 'PENDING',
        type: type || 'DINE_IN',
        subtotal,
        tax,
        total,
        notes,
        restaurant: {
          connect: { id: restaurantId }
        },
        user: {
          connect: { id: req.user.id }
        },
        table: tableId ? {
          connect: { id: tableId }
        } : undefined,
        customer: customerId ? {
          connect: { id: customerId }
        } : undefined
      }
    });

    // Create order items
    for (const item of validatedItems) {
      const orderItem = await prisma.orderItem.create({
        data: {
          quantity: item.quantity,
          price: item.price,
          notes: item.notes,
          order: {
            connect: { id: order.id }
          },
          menuItem: {
            connect: { id: item.menuItemId }
          }
        }
      });

      // Create order item modifiers
      if (item.modifiers.length > 0) {
        for (const modifier of item.modifiers) {
          await prisma.orderItemModifier.create({
            data: {
              price: modifier.price,
              orderItem: {
                connect: { id: orderItem.id }
              },
              modifier: {
                connect: { id: modifier.modifierId }
              }
            }
          });
        }
      }

      // Update inventory (handled in a separate function or middleware)
      // This will decrease inventory based on the order items
      // await updateInventory(item.menuItemId, item.quantity);
    }

    // Get the complete order with all related data
    const createdOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        customer: true,
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
      }
    });

    res.status(201).json({
      success: true,
      data: createdOrder
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an order's status
 * @route   PUT /api/orders/:id/status
 * @access  Private
 */
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        table: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    // Update data object
    const updateData = { status };

    // If order is completed or cancelled, add completedAt timestamp
    if (status === 'COMPLETED' || status === 'CANCELLED') {
      updateData.completedAt = new Date();
      
      // If table exists and order is the last active for this table, update table status
      if (order.tableId) {
        const activeOrders = await prisma.order.count({
          where: {
            tableId: order.tableId,
            status: {
              in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
            },
            NOT: {
              id
            }
          }
        });
        
        if (activeOrders === 0) {
          await prisma.table.update({
            where: { id: order.tableId },
            data: { status: 'AVAILABLE' }
          });
        }
      }
    }

    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        customer: true,
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
      }
    });

    res.status(200).json({
      success: true,
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add items to an existing order
 * @route   POST /api/orders/:id/items
 * @access  Private
 */
exports.addOrderItems = async (req, res, next) => {
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
    const { orderItems } = req.body;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    // Only allow adding items to pending, preparing, or ready orders
    if (!['PENDING', 'PREPARING', 'READY'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot add items to an order with status ${order.status}`
      });
    }

    // Validate order items
    if (!orderItems || !Array.isArray(orderItems) || orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Must provide at least one order item'
      });
    }

    // Calculate additional amount and validate items
    let additionalSubtotal = 0;
    const validatedItems = [];

    for (const item of orderItems) {
      const { menuItemId, quantity, modifierIds, notes: itemNotes } = item;

      // Check menu item exists and belongs to the restaurant
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: menuItemId },
        include: {
          modifierGroups: {
            include: {
              modifiers: true
            }
          }
        }
      });

      if (!menuItem) {
        return res.status(404).json({
          success: false,
          message: `Menu item with ID ${menuItemId} not found`
        });
      }

      if (menuItem.restaurantId !== order.restaurantId) {
        return res.status(400).json({
          success: false,
          message: `Menu item with ID ${menuItemId} does not belong to this restaurant`
        });
      }

      if (!menuItem.available) {
        return res.status(400).json({
          success: false,
          message: `Menu item "${menuItem.name}" is not available`
        });
      }

      // Process modifiers if present
      let modifiersPrice = 0;
      const validatedModifiers = [];

      if (modifierIds && modifierIds.length > 0) {
        for (const modifierId of modifierIds) {
          // Find modifier in menu item's available modifiers
          let modifierFound = false;
          let modifier = null;

          for (const group of menuItem.modifierGroups) {
            modifier = group.modifiers.find(m => m.id === modifierId);
            if (modifier) {
              modifierFound = true;
              break;
            }
          }

          if (!modifierFound) {
            return res.status(400).json({
              success: false,
              message: `Modifier with ID ${modifierId} is not valid for menu item "${menuItem.name}"`
            });
          }

          if (!modifier.available) {
            return res.status(400).json({
              success: false,
              message: `Modifier "${modifier.name}" is not available`
            });
          }

          modifiersPrice += modifier.price;
          validatedModifiers.push({
            modifierId,
            price: modifier.price
          });
        }
      }

      const itemTotal = (menuItem.price + modifiersPrice) * quantity;
      additionalSubtotal += itemTotal;

      validatedItems.push({
        menuItemId,
        quantity,
        price: menuItem.price,
        notes: itemNotes,
        modifiers: validatedModifiers
      });
    }

    // Calculate new totals
    const taxRate = await prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
      select: { taxRate: true }
    }).then(restaurant => restaurant.taxRate || 0);
    
    const newSubtotal = order.subtotal + additionalSubtotal;
    const newTax = newSubtotal * (taxRate / 100);
    const newTotal = newSubtotal + newTax;

    // Create new order items
    for (const item of validatedItems) {
      const orderItem = await prisma.orderItem.create({
        data: {
          quantity: item.quantity,
          price: item.price,
          notes: item.notes,
          order: {
            connect: { id: order.id }
          },
          menuItem: {
            connect: { id: item.menuItemId }
          }
        }
      });

      // Create order item modifiers
      if (item.modifiers.length > 0) {
        for (const modifier of item.modifiers) {
          await prisma.orderItemModifier.create({
            data: {
              price: modifier.price,
              orderItem: {
                connect: { id: orderItem.id }
              },
              modifier: {
                connect: { id: modifier.modifierId }
              }
            }
          });
        }
      }

      // Update inventory (handled in a separate function or middleware)
      // This will decrease inventory based on the order items
      // await updateInventory(item.menuItemId, item.quantity);
    }

    // Update order totals
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        subtotal: newSubtotal,
        tax: newTax,
        total: newTotal
      },
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
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
      }
    });

    res.status(200).json({
      success: true,
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an order item
 * @route   PUT /api/orders/:orderId/items/:itemId
 * @access  Private
 */
exports.updateOrderItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { quantity, notes, status } = req.body;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    // Only allow updating items for pending, preparing, or ready orders
    if (!['PENDING', 'PREPARING', 'READY'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update items for an order with status ${order.status}`
      });
    }

    // Check if item exists and belongs to the order
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        id: itemId,
        orderId
      },
      include: {
        menuItem: true
      }
    });

    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: 'Order item not found'
      });
    }

    // Build update data
    const updateData = {};
    if (quantity !== undefined && quantity > 0) updateData.quantity = quantity;
    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;

    // Update order item
    const updatedOrderItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: updateData,
      include: {
        menuItem: true,
        modifiers: {
          include: {
            modifier: true
          }
        }
      }
    });

    // Recalculate order totals if quantity changed
    if (quantity !== undefined && quantity !== orderItem.quantity) {
      // Get all order items
      const allOrderItems = await prisma.orderItem.findMany({
        where: { orderId },
        include: {
          menuItem: true,
          modifiers: true
        }
      });

      // Calculate new subtotal
      let newSubtotal = 0;
      for (const item of allOrderItems) {
        let itemPrice = item.price;
        
        // Add modifiers price
        for (const mod of item.modifiers) {
          itemPrice += mod.price;
        }
        
        newSubtotal += itemPrice * item.quantity;
      }

      // Calculate new tax and total
      const taxRate = await prisma.restaurant.findUnique({
        where: { id: order.restaurantId },
        select: { taxRate: true }
      }).then(restaurant => restaurant.taxRate || 0);
      
      const newTax = newSubtotal * (taxRate / 100);
      const newTotal = newSubtotal + newTax;

      // Update order totals
      await prisma.order.update({
        where: { id: orderId },
        data: {
          subtotal: newSubtotal,
          tax: newTax,
          total: newTotal
        }
      });
    }

    res.status(200).json({
      success: true,
      data: updatedOrderItem
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove an item from an order
 * @route   DELETE /api/orders/:orderId/items/:itemId
 * @access  Private
 */
exports.removeOrderItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order'
      });
    }

    // Only allow removing items from pending orders
    if (order.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Cannot remove items from an order with status ${order.status}`
      });
    }

    // Don't allow removing if this is the last item
    if (order.orderItems.length <= 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the last item from an order. Delete the order instead.'
      });
    }

    // Check if item exists and belongs to the order
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        id: itemId,
        orderId
      },
      include: {
        menuItem: true,
        modifiers: true
      }
    });

    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: 'Order item not found'
      });
    }

    // Calculate item total to subtract from order
    let itemPrice = orderItem.price;
    for (const mod of orderItem.modifiers) {
      itemPrice += mod.price;
    }
    const itemTotal = itemPrice * orderItem.quantity;

    // Delete order item modifiers first
    await prisma.orderItemModifier.deleteMany({
      where: { orderItemId: itemId }
    });

    // Delete order item
    await prisma.orderItem.delete({
      where: { id: itemId }
    });

    // Recalculate order totals
    const newSubtotal = order.subtotal - itemTotal;
    
    const taxRate = await prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
      select: { taxRate: true }
    }).then(restaurant => restaurant.taxRate || 0);
    
    const newTax = newSubtotal * (taxRate / 100);
    const newTotal = newSubtotal + newTax;

    // Update order totals
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal: newSubtotal,
        tax: newTax,
        total: newTotal
      },
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
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
      }
    });

    res.status(200).json({
      success: true,
      message: 'Order item removed successfully',
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Cancel an order
 * @route   PUT /api/orders/:id/cancel
 * @access  Private/Manager/Admin
 */
exports.cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        table: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Only allow cancelling pending, preparing, or ready orders
    if (!['PENDING', 'PREPARING', 'READY'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel an order with status ${order.status}`
      });
    }

    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        completedAt: new Date()
      },
      include: {
        table: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
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
      }
    });

    // If this is the last active order for the table, update table status
    if (order.tableId) {
      const activeOrders = await prisma.order.count({
        where: {
          tableId: order.tableId,
          status: {
            in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
          },
          NOT: {
            id
          }
        }
      });
      
      if (activeOrders === 0) {
        await prisma.table.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' }
        });
      }
    }

    res.status(200).json({
      success: true,
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
};