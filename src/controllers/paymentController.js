const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all payments
 * @route   GET /api/payments
 * @access  Private/Manager/Admin
 */
exports.getPayments = async (req, res, next) => {
  try {
    const { 
      orderId, 
      status, 
      method,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter condition
    const where = {};
    
    // Filter by order
    if (orderId) {
      where.orderId = orderId;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by payment method
    if (method) {
      where.method = method;
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

    // If not admin, limit to user's restaurant
    if (req.user.role !== 'ADMIN' && req.user.restaurantId) {
      where.order = {
        restaurantId: req.user.restaurantId
      };
    }
    
    // Get payments count for pagination
    const totalPayments = await prisma.payment.count({
      where
    });

    // Get payments with pagination
    const payments = await prisma.payment.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
            restaurantId: true
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
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: payments.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalPayments,
        pages: Math.ceil(totalPayments / parseInt(limit))
      },
      data: payments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single payment
 * @route   GET /api/payments/:id
 * @access  Private/Manager/Admin
 */
exports.getPayment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            restaurant: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      payment.order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this payment'
      });
    }

    res.status(200).json({
      success: true,
      data: payment
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a payment
 * @route   POST /api/payments
 * @access  Private
 */
exports.createPayment = async (req, res, next) => {
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
      orderId, 
      amount, 
      method, 
      transactionId 
    } = req.body;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
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
        message: 'Not authorized to create payment for this order'
      });
    }

    // Only allow payments for orders that are not cancelled
    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot process payment for a cancelled order'
      });
    }

    // Calculate amount already paid
    const totalPaid = order.payments.reduce((sum, payment) => {
      if (payment.status === 'COMPLETED') {
        return sum + payment.amount;
      }
      return sum;
    }, 0);

    // Check if payment would exceed order total
    if (totalPaid + amount > order.total) {
      return res.status(400).json({
        success: false,
        message: `Payment would exceed order total. Order total: ${order.total}, already paid: ${totalPaid}, new payment: ${amount}`
      });
    }

    // Create payment
    const payment = await prisma.payment.create({
      data: {
        amount,
        method,
        status: 'COMPLETED', // Auto-complete for now, in real system might be PENDING until confirmed
        transactionId,
        order: {
          connect: { id: orderId }
        },
        user: {
          connect: { id: req.user.id }
        }
      },
      include: {
        order: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Check if order is fully paid after this payment
    const newTotalPaid = totalPaid + amount;
    if (newTotalPaid >= order.total) {
      // If order is fully paid and served, mark as completed
      if (order.status === 'SERVED') {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date()
          }
        });
      }
      
      // If this is the last active order for the table, update table status
      if (order.tableId) {
        const activeOrders = await prisma.order.count({
          where: {
            tableId: order.tableId,
            status: {
              in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
            },
            NOT: {
              id: orderId
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

    res.status(201).json({
      success: true,
      data: payment,
      remainingBalance: order.total - newTotalPaid,
      isFullyPaid: newTotalPaid >= order.total
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refund a payment
 * @route   POST /api/payments/:id/refund
 * @access  Private/Manager/Admin
 */
exports.refundPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Check if payment exists
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        order: true
      }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      payment.order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to refund this payment'
      });
    }

    // Only allow refunding completed payments
    if (payment.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: `Cannot refund a payment with status ${payment.status}`
      });
    }

    // Update payment status to refunded
    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: {
        status: 'REFUNDED'
      },
      include: {
        order: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Log refund (in a real system, would likely use a separate table)
    console.log(`Payment ${id} refunded: ${reason}`);

    res.status(200).json({
      success: true,
      data: updatedPayment
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get order payment summary
 * @route   GET /api/payments/order/:orderId/summary
 * @access  Private
 */
exports.getOrderPaymentSummary = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
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

    // Calculate payment summary
    const totalPaid = order.payments
      .filter(payment => payment.status === 'COMPLETED')
      .reduce((sum, payment) => sum + payment.amount, 0);
    
    const totalRefunded = order.payments
      .filter(payment => payment.status === 'REFUNDED')
      .reduce((sum, payment) => sum + payment.amount, 0);
    
    const remainingBalance = order.total - totalPaid;
    
    const paymentMethods = {};
    order.payments
      .filter(payment => payment.status === 'COMPLETED')
      .forEach(payment => {
        if (!paymentMethods[payment.method]) {
          paymentMethods[payment.method] = 0;
        }
        paymentMethods[payment.method] += payment.amount;
      });

    res.status(200).json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTotal: order.total,
        totalPaid,
        totalRefunded,
        remainingBalance,
        isFullyPaid: remainingBalance <= 0,
        paymentMethods,
        payments: order.payments.map(payment => ({
          id: payment.id,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          createdAt: payment.createdAt
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};