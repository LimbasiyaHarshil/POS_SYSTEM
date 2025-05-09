const prisma = require('../utils/prisma');

/**
 * @desc    Get all pending orders for kitchen
 * @route   GET /api/kitchen/orders
 * @access  Private/Kitchen
 */
exports.getKitchenOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    
    // Build filter condition
    const where = {
      restaurantId: req.user.restaurantId
    };
    
    // Filter by status
    if (status) {
      where.status = status;
    } else {
      where.status = {
        in: ['PENDING', 'PREPARING', 'READY']
      };
    }

    // Get orders for kitchen display
    const orders = await prisma.order.findMany({
      where,
      include: {
        table: {
          select: {
            id: true,
            number: true
          }
        },
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                preparationTime: true
              }
            },
            modifiers: {
              include: {
                modifier: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: [
        {
          createdAt: 'asc'
        }
      ]
    });

    // Transform orders for kitchen display
    const kitchenOrders = orders.map(order => {
      // Calculate estimated preparation time
      const prepTimes = order.orderItems.map(
        item => item.menuItem?.preparationTime || 10
      );
      const maxPrepTime = Math.max(...prepTimes, 0);
      
      // Calculate how long ago the order was created
      const orderAge = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000); // in minutes
      
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        type: order.type,
        tableNumber: order.table?.number,
        createdAt: order.createdAt,
        orderAge,
        estimatedPrepTime: maxPrepTime,
        isOverdue: orderAge > maxPrepTime && order.status !== 'READY',
        server: `${order.user.firstName} ${order.user.lastName}`,
        items: order.orderItems.map(item => ({
          id: item.id,
          name: item.menuItem?.name || 'Unknown Item',
          quantity: item.quantity,
          status: item.status,
          notes: item.notes,
          modifiers: item.modifiers.map(mod => mod.modifier.name).join(', ')
        }))
      };
    });

    res.status(200).json({
      success: true,
      count: kitchenOrders.length,
      data: kitchenOrders
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update order item status
 * @route   PUT /api/kitchen/order-items/:id/status
 * @access  Private/Kitchen
 */
exports.updateOrderItemStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    // Check if order item exists
    const orderItem = await prisma.orderItem.findUnique({
      where: { id },
      include: {
        order: true
      }
    });

    if (!orderItem) {
      return res.status(404).json({
        success: false,
        message: 'Order item not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      orderItem.order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order item'
      });
    }

    // Update order item status
    const updatedOrderItem = await prisma.orderItem.update({
      where: { id },
      data: { status },
      include: {
        menuItem: true,
        order: true
      }
    });

    // Check if all order items are ready or served
    const allOrderItems = await prisma.orderItem.findMany({
      where: { orderId: orderItem.orderId }
    });

    const allReady = allOrderItems.every(
      item => item.status === 'READY' || item.status === 'SERVED'
    );
    
    const allServed = allOrderItems.every(
      item => item.status === 'SERVED'
    );

    // Update order status if needed
    if (allServed && orderItem.order.status !== 'SERVED') {
      await prisma.order.update({
        where: { id: orderItem.orderId },
        data: { status: 'SERVED' }
      });
    } else if (allReady && orderItem.order.status === 'PENDING' || orderItem.order.status === 'PREPARING') {
      await prisma.order.update({
        where: { id: orderItem.orderId },
        data: { status: 'READY' }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: updatedOrderItem.id,
        status: updatedOrderItem.status,
        name: updatedOrderItem.menuItem?.name,
        quantity: updatedOrderItem.quantity,
        orderId: updatedOrderItem.orderId,
        orderNumber: updatedOrderItem.order.orderNumber
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update order status for kitchen
 * @route   PUT /api/kitchen/orders/:id/status
 * @access  Private/Kitchen
 */
exports.updateKitchenOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    if (!['PREPARING', 'READY'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Kitchen can only set orders to PREPARING or READY'
      });
    }

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id }
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

    // Only allow status change for pending or preparing orders
    if (!['PENDING', 'PREPARING'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change kitchen status for an order with status ${order.status}`
      });
    }

    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status },
      include: {
        table: {
          select: {
            id: true,
            number: true
          }
        }
      }
    });

    // If status is changed to PREPARING, update all pending items to PREPARING
    if (status === 'PREPARING') {
      await prisma.orderItem.updateMany({
        where: {
          orderId: id,
          status: 'PENDING'
        },
        data: {
          status: 'PREPARING'
        }
      });
    }

    // If status is changed to READY, update all preparing items to READY
    if (status === 'READY') {
      await prisma.orderItem.updateMany({
        where: {
          orderId: id,
          status: 'PREPARING'
        },
        data: {
          status: 'READY'
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        status: updatedOrder.status,
        tableNumber: updatedOrder.table?.number,
        type: updatedOrder.type
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get kitchen statistics
 * @route   GET /api/kitchen/stats
 * @access  Private/Kitchen/Manager/Admin
 */
exports.getKitchenStats = async (req, res, next) => {
  try {
    // Get statistics for current restaurant
    const restaurantId = req.user.restaurantId;
    
    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'No restaurant associated with user'
      });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Get counts of orders by status
    const pendingCount = await prisma.order.count({
      where: {
        restaurantId,
        status: 'PENDING',
        createdAt: {
          gte: today
        }
      }
    });
    
    const preparingCount = await prisma.order.count({
      where: {
        restaurantId,
        status: 'PREPARING',
        createdAt: {
          gte: today
        }
      }
    });
    
    const readyCount = await prisma.order.count({
      where: {
        restaurantId,
        status: 'READY',
        createdAt: {
          gte: today
        }
      }
    });
    
    const completedCount = await prisma.order.count({
      where: {
        restaurantId,
        status: 'COMPLETED',
        createdAt: {
          gte: today
        }
      }
    });

    // Get average preparation time for completed orders today
    const completedOrders = await prisma.order.findMany({
      where: {
        restaurantId,
        status: 'COMPLETED',
        createdAt: {
          gte: today
        },
        completedAt: {
          not: null
        }
      },
      select: {
        createdAt: true,
        completedAt: true
      }
    });
    
    let avgPrepTimeMinutes = 0;
    if (completedOrders.length > 0) {
      const totalPrepTime = completedOrders.reduce((sum, order) => {
        const prepTimeMs = new Date(order.completedAt).getTime() - new Date(order.createdAt).getTime();
        return sum + prepTimeMs;
      }, 0);
      avgPrepTimeMinutes = Math.round((totalPrepTime / completedOrders.length) / 60000); // Convert to minutes
    }

    // Get oldest pending and preparing orders
    const oldestPending = await prisma.order.findFirst({
      where: {
        restaurantId,
        status: 'PENDING'
      },
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true
      }
    });
    
    const oldestPreparing = await prisma.order.findFirst({
      where: {
        restaurantId,
        status: 'PREPARING'
      },
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true
      }
    });

    // Calculate wait time for oldest orders
    let oldestPendingWaitMinutes = 0;
    if (oldestPending) {
      oldestPendingWaitMinutes = Math.round((now - new Date(oldestPending.createdAt)) / 60000);
    }
    
    let oldestPreparingWaitMinutes = 0;
    if (oldestPreparing) {
      oldestPreparingWaitMinutes = Math.round((now - new Date(oldestPreparing.createdAt)) / 60000);
    }

    res.status(200).json({
      success: true,
      data: {
        orderCounts: {
          pending: pendingCount,
          preparing: preparingCount,
          ready: readyCount,
          completed: completedCount,
          total: pendingCount + preparingCount + readyCount + completedCount
        },
        averagePrepTimeMinutes: avgPrepTimeMinutes,
        oldestPending: oldestPending 
          ? { ...oldestPending, waitTimeMinutes: oldestPendingWaitMinutes }
          : null,
        oldestPreparing: oldestPreparing
          ? { ...oldestPreparing, waitTimeMinutes: oldestPreparingWaitMinutes }
          : null
      }
    });
  } catch (error) {
    next(error);
  }
};