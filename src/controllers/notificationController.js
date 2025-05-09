const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all notifications for current user
 * @route   GET /api/notifications
 * @access  Private
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const { 
      read, 
      priority,
      page = 1,
      limit = 20
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter condition
    const where = {
      OR: [
        { recipientId: req.user.id },
        { 
          restaurantId: req.user.restaurantId,
          recipientId: null // For broadcast notifications to all restaurant staff
        }
      ]
    };
    
    // Filter by read status
    if (read !== undefined) {
      where.isRead = read === 'true';
    }

    // Filter by priority
    if (priority) {
      where.priority = priority;
    }
    
    // Get notifications count for pagination
    const totalNotifications = await prisma.notification.count({
      where
    });

    // Get notifications with pagination
    const notifications = await prisma.notification.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: [
        {
          priority: 'desc'
        },
        {
          createdAt: 'desc'
        }
      ],
      skip,
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount: await prisma.notification.count({
        where: {
          ...where,
          isRead: false
        }
      }),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalNotifications,
        pages: Math.ceil(totalNotifications / parseInt(limit))
      },
      data: notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if notification exists and user has access
    const notification = await prisma.notification.findUnique({
      where: { id }
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user has access to this notification
    if (
      notification.recipientId && notification.recipientId !== req.user.id ||
      notification.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this notification'
      });
    }

    // Mark as read
    const updatedNotification = await prisma.notification.update({
      where: { id },
      data: { isRead: true }
    });

    res.status(200).json({
      success: true,
      data: updatedNotification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/mark-all-read
 * @access  Private
 */
exports.markAllAsRead = async (req, res, next) => {
  try {
    // Update all unread notifications for the user
    await prisma.notification.updateMany({
      where: {
        OR: [
          { recipientId: req.user.id },
          { 
            restaurantId: req.user.restaurantId,
            recipientId: null // For broadcast notifications to all restaurant staff
          }
        ],
        isRead: false
      },
      data: { isRead: true }
    });

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a notification (admin/manager only)
 * @route   POST /api/notifications
 * @access  Private/Manager/Admin
 */
exports.createNotification = async (req, res, next) => {
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
      title, 
      message, 
      recipientId, 
      priority = 'MEDIUM',
      link
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

    // If recipient is specified, make sure they belong to this restaurant
    if (recipientId) {
      const recipient = await prisma.user.findUnique({
        where: { id: recipientId }
      });

      if (!recipient) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }

      if (recipient.restaurantId !== restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Recipient must belong to the same restaurant'
        });
      }
    }

    // Create notification
    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        priority,
        link,
        isRead: false,
        sender: {
          connect: { id: req.user.id }
        },
        recipient: recipientId ? {
          connect: { id: recipientId }
        } : undefined,
        restaurant: {
          connect: { id: restaurantId }
        }
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        recipient: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
exports.deleteNotification = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if notification exists
    const notification = await prisma.notification.findUnique({
    where: { id }
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    // Check if user has access to delete this notification
    if (notification.recipientId !== req.user.id && 
        req.user.role !== 'ADMIN' && 
        (req.user.role !== 'MANAGER' || notification.restaurantId !== req.user.restaurantId)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this notification'
      });
    }

    // Delete notification
    await prisma.notification.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a system notification (internal use only)
 * @access  Private (internal)
 */
exports.createSystemNotification = async ({
  title,
  message,
  recipientId,
  restaurantId,
  priority = 'MEDIUM',
  link,
  type
}) => {
  try {
    // Create notification
    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        priority,
        link,
        type,
        isRead: false,
        recipient: recipientId ? {
          connect: { id: recipientId }
        } : undefined,
        restaurant: restaurantId ? {
          connect: { id: restaurantId }
        } : undefined
      }
    });

    // In a real application, you would emit a socket event here to notify clients
    // io.to(`user:${recipientId}`).emit('notification', notification);
    // if (restaurantId) {
    //   io.to(`restaurant:${restaurantId}`).emit('notification', notification);
    // }

    return notification;
  } catch (error) {
    console.error('Error creating system notification:', error);
    return null;
  }
};

/**
 * @desc    Send low stock notification
 * @access  Private (internal)
 */
exports.sendLowStockNotification = async (inventoryItem, restaurantId) => {
  try {
    const message = `${inventoryItem.name} is below the reorder level of ${inventoryItem.reorderLevel} ${inventoryItem.unitType}. Current stock: ${inventoryItem.quantity} ${inventoryItem.unitType}`;
    
    // Find managers to notify
    const managers = await prisma.user.findMany({
      where: {
        restaurantId,
        role: 'MANAGER'
      },
      select: {
        id: true
      }
    });

    // Create notifications for all managers
    for (const manager of managers) {
      await exports.createSystemNotification({
        title: 'Low Stock Alert',
        message,
        recipientId: manager.id,
        restaurantId,
        priority: 'HIGH',
        link: `/inventory/${inventoryItem.id}`,
        type: 'INVENTORY'
      });
    }

    return true;
  } catch (error) {
    console.error('Error sending low stock notification:', error);
    return false;
  }
};

/**
 * @desc    Send order notification
 * @access  Private (internal)
 */
exports.sendOrderNotification = async (order, type) => {
  try {
    let title, message, priority, recipientRole;
    
    switch (type) {
      case 'NEW':
        title = `New Order #${order.orderNumber}`;
        message = `A new order has been placed for ${order.type === 'DINE_IN' ? `table ${order.table?.number}` : order.type}`;
        priority = 'HIGH';
        recipientRole = 'KITCHEN';
        break;
      case 'READY':
        title = `Order #${order.orderNumber} Ready`;
        message = `Order for ${order.type === 'DINE_IN' ? `table ${order.table?.number}` : order.type} is ready for service`;
        priority = 'HIGH';
        recipientRole = 'SERVER';
        break;
      case 'CANCELLED':
        title = `Order #${order.orderNumber} Cancelled`;
        message = `Order for ${order.type === 'DINE_IN' ? `table ${order.table?.number}` : order.type} has been cancelled`;
        priority = 'MEDIUM';
        recipientRole = 'KITCHEN';
        break;
      default:
        return null;
    }
    
    // Find staff members to notify based on role
    const staff = await prisma.user.findMany({
      where: {
        restaurantId: order.restaurantId,
        role: recipientRole
      },
      select: {
        id: true
      }
    });

    // Create notifications for all applicable staff
    for (const member of staff) {
      await exports.createSystemNotification({
        title,
        message,
        recipientId: member.id,
        restaurantId: order.restaurantId,
        priority,
        link: `/orders/${order.id}`,
        type: 'ORDER'
      });
    }

    return true;
  } catch (error) {
    console.error('Error sending order notification:', error);
    return false;
  }
};

/**
 * @desc    Send reservation notification
 * @access  Private (internal)
 */
exports.sendReservationNotification = async (reservation) => {
  try {
    const formattedTime = new Date(reservation.reservationTime).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    const formattedDate = new Date(reservation.reservationTime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
    const title = 'Upcoming Reservation';
    const message = `Reservation for party of ${reservation.partySize} at ${formattedTime} on ${formattedDate} (${reservation.customer.firstName} ${reservation.customer.lastName})`;
    
    // Find servers and managers to notify
    const staff = await prisma.user.findMany({
      where: {
        restaurantId: reservation.restaurantId,
        role: {
          in: ['SERVER', 'MANAGER']
        }
      },
      select: {
        id: true
      }
    });

    // Create notifications for all applicable staff
    for (const member of staff) {
      await exports.createSystemNotification({
        title,
        message,
        recipientId: member.id,
        restaurantId: reservation.restaurantId,
        priority: 'MEDIUM',
        link: `/reservations/${reservation.id}`,
        type: 'RESERVATION'
      });
    }

    return true;
  } catch (error) {
    console.error('Error sending reservation notification:', error);
    return false;
  }
};