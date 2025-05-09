const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const crypto = require('crypto');

/**
 * @desc    Get all vouchers
 * @route   GET /api/vouchers
 * @access  Private/Manager/Admin
 */
exports.getVouchers = async (req, res, next) => {
  try {
    const { 
      restaurantId, 
      isActive,
      type,
      code,
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

    // Filter by active status
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Filter by type
    if (type) {
      where.type = type;
    }

    // Filter by code
    if (code) {
      where.code = code;
    }
    
    // Get vouchers count for pagination
    const totalVouchers = await prisma.voucher.count({
      where
    });

    // Get vouchers with pagination
    const vouchers = await prisma.voucher.findMany({
      where,
      include: {
        _count: {
          select: {
            redemptions: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: parseInt(limit)
    });

    // Enhance vouchers with additional information
    const enhancedVouchers = vouchers.map(voucher => {
      const now = new Date();
      const isExpired = now > new Date(voucher.expiryDate);
      const isValid = voucher.isActive && !isExpired && (voucher.usageLimit === null || voucher.usageCount < voucher.usageLimit);
      
      return {
        ...voucher,
        isExpired,
        isValid,
        remainingUses: voucher.usageLimit === null ? null : voucher.usageLimit - voucher.usageCount
      };
    });

    res.status(200).json({
      success: true,
      count: vouchers.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalVouchers,
        pages: Math.ceil(totalVouchers / parseInt(limit))
      },
      data: enhancedVouchers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single voucher
 * @route   GET /api/vouchers/:id
 * @access  Private
 */
exports.getVoucher = async (req, res, next) => {
  try {
    const { id } = req.params;

    const voucher = await prisma.voucher.findUnique({
      where: { id },
      include: {
        redemptions: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                total: true,
                createdAt: true
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
          }
        }
      }
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      voucher.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this voucher'
      });
    }

    // Check voucher status
    const now = new Date();
    const isExpired = now > new Date(voucher.expiryDate);
    const isNotStarted = now < new Date(voucher.startDate);
    const isUsedUp = voucher.usageLimit !== null && voucher.usageCount >= voucher.usageLimit;
    const isValid = voucher.isActive && !isExpired && !isNotStarted && !isUsedUp;

    res.status(200).json({
      success: true,
      data: {
        ...voucher,
        isExpired,
        isNotStarted,
        isUsedUp,
        isValid,
        remainingUses: voucher.usageLimit === null ? null : voucher.usageLimit - voucher.usageCount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a voucher
 * @route   POST /api/vouchers
 * @access  Private/Manager/Admin
 */
exports.createVoucher = async (req, res, next) => {
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
      code,
      type,
      value,
      minPurchase = 0,
      startDate,
      expiryDate,
      usageLimit,
      isActive = true
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

    // Generate code if not provided
    const voucherCode = code || generateVoucherCode();

    // Check if code already exists
    const existingVoucher = await prisma.voucher.findFirst({
      where: {
        code: voucherCode,
        restaurantId
      }
    });

    if (existingVoucher) {
      return res.status(400).json({
        success: false,
        message: 'Voucher code already exists'
      });
    }

    // Create voucher
    const voucher = await prisma.voucher.create({
      data: {
        code: voucherCode,
        type,
        value,
        minPurchase,
        isActive,
        startDate: new Date(startDate),
        expiryDate: new Date(expiryDate),
        usageLimit,
        restaurant: {
          connect: { id: restaurantId }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: voucher
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a voucher
 * @route   PUT /api/vouchers/:id
 * @access  Private/Manager/Admin
 */
exports.updateVoucher = async (req, res, next) => {
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
      value,
      minPurchase,
      startDate,
      expiryDate,
      usageLimit,
      isActive
    } = req.body;

    // Check if voucher exists
    const voucher = await prisma.voucher.findUnique({
      where: { id }
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      voucher.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this voucher'
      });
    }

    // Build update data
    const updateData = {};
    if (value !== undefined) updateData.value = value;
    if (minPurchase !== undefined) updateData.minPurchase = minPurchase;
    if (startDate) updateData.startDate = new Date(startDate);
    if (expiryDate) updateData.expiryDate = new Date(expiryDate);
    if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update voucher
    const updatedVoucher = await prisma.voucher.update({
      where: { id },
      data: updateData
    });

    // Check voucher status
    const now = new Date();
    const isExpired = now > new Date(updatedVoucher.expiryDate);
    const isNotStarted = now < new Date(updatedVoucher.startDate);
    const isUsedUp = updatedVoucher.usageLimit !== null && updatedVoucher.usageCount >= updatedVoucher.usageLimit;
    const isValid = updatedVoucher.isActive && !isExpired && !isNotStarted && !isUsedUp;

    res.status(200).json({
      success: true,
      data: {
        ...updatedVoucher,
        isExpired,
        isNotStarted,
        isUsedUp,
        isValid,
        remainingUses: updatedVoucher.usageLimit === null ? null : updatedVoucher.usageLimit - updatedVoucher.usageCount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Validate a voucher
 * @route   POST /api/vouchers/validate
 * @access  Private
 */
exports.validateVoucher = async (req, res, next) => {
  try {
    const { code, totalAmount } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Voucher code is required'
      });
    }

    // Find voucher by code
    const voucher = await prisma.voucher.findFirst({
      where: {
        code,
        restaurantId: req.user.restaurantId
      }
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Check if voucher is active
    if (!voucher.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Voucher is inactive',
        isValid: false
      });
    }

    // Check date restrictions
    const now = new Date();
    if (now < new Date(voucher.startDate)) {
      return res.status(400).json({
        success: false,
        message: `Voucher is not valid until ${new Date(voucher.startDate).toLocaleDateString()}`,
        isValid: false
      });
    }

    if (now > new Date(voucher.expiryDate)) {
      return res.status(400).json({
        success: false,
        message: `Voucher expired on ${new Date(voucher.expiryDate).toLocaleDateString()}`,
        isValid: false
      });
    }

    // Check usage limits
    if (voucher.usageLimit !== null && voucher.usageCount >= voucher.usageLimit) {
      return res.status(400).json({
        success: false,
        message: 'Voucher has reached its usage limit',
        isValid: false
      });
    }

    // Check minimum purchase amount if provided
    if (totalAmount && voucher.minPurchase > totalAmount) {
      return res.status(400).json({
        success: false,
        message: `Voucher requires a minimum purchase of $${voucher.minPurchase.toFixed(2)}`,
        isValid: false,
        minPurchase: voucher.minPurchase
      });
    }

    // Calculate discount amount if totalAmount is provided
    let discountAmount = null;
    if (totalAmount) {
      if (voucher.type === 'PERCENTAGE') {
        discountAmount = (totalAmount * voucher.value) / 100;
      } else if (voucher.type === 'FIXED_AMOUNT') {
        discountAmount = Math.min(voucher.value, totalAmount);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        voucher: {
          id: voucher.id,
          code: voucher.code,
          type: voucher.type,
          value: voucher.value,
          minPurchase: voucher.minPurchase,
          isActive: voucher.isActive,
          startDate: voucher.startDate,
          expiryDate: voucher.expiryDate,
          usageCount: voucher.usageCount,
          usageLimit: voucher.usageLimit,
          remainingUses: voucher.usageLimit === null ? null : voucher.usageLimit - voucher.usageCount
        },
        isValid: true,
        discountAmount,
        discountedTotal: totalAmount ? totalAmount - discountAmount : null
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Apply a voucher to an order
 * @route   POST /api/vouchers/apply
 * @access  Private
 */
exports.applyVoucher = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { code, orderId } = req.body;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        restaurant: true,
        voucherRedemptions: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this order
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this order'
      });
    }

    // Check if voucher is already applied to this order
    if (order.voucherRedemptions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'A voucher has already been applied to this order'
      });
    }

    // Find voucher by code
    const voucher = await prisma.voucher.findFirst({
      where: {
        code,
        restaurantId: order.restaurantId
      }
    });

    if (!voucher) {
      return res.status(404).json({
        success: false,
        message: 'Voucher not found'
      });
    }

    // Validate voucher
    const now = new Date("2025-05-09T05:49:52Z"); // Using the current timestamp provided
    
    // Check if voucher is active
    if (!voucher.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Voucher is inactive'
      });
    }

    // Check date restrictions
    if (now < new Date(voucher.startDate)) {
      return res.status(400).json({
        success: false,
        message: `Voucher is not valid until ${new Date(voucher.startDate).toLocaleDateString()}`
      });
    }

    if (now > new Date(voucher.expiryDate)) {
      return res.status(400).json({
        success: false,
        message: `Voucher expired on ${new Date(voucher.expiryDate).toLocaleDateString()}`
      });
    }

    // Check usage limits
    if (voucher.usageLimit !== null && voucher.usageCount >= voucher.usageLimit) {
      return res.status(400).json({
        success: false,
        message: 'Voucher has reached its usage limit'
      });
    }

    // Check minimum purchase amount
    if (voucher.minPurchase > order.subtotal) {
      return res.status(400).json({
        success: false,
        message: `Voucher requires a minimum purchase of $${voucher.minPurchase.toFixed(2)}`
      });
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (voucher.type === 'PERCENTAGE') {
      discountAmount = (order.subtotal * voucher.value) / 100;
    } else if (voucher.type === 'FIXED_AMOUNT') {
      discountAmount = Math.min(voucher.value, order.subtotal);
    } else if (voucher.type === 'FREE_ITEM') {
      // For FREE_ITEM, the voucher value represents the maximum value of the free item
      // This is simplified - in a real system, you'd likely have a separate field to indicate which items are eligible
      discountAmount = voucher.value;
    }

    // Round to 2 decimal places
    discountAmount = Math.round(discountAmount * 100) / 100;

    // Calculate new totals
    const newSubtotal = Math.max(0, order.subtotal - discountAmount);
    const taxRate = order.restaurant.taxRate || 0;
    const newTax = (newSubtotal * taxRate) / 100;
    const newTotal = newSubtotal + newTax + (order.tip || 0);

    // Update order with new totals
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal: newSubtotal,
        tax: newTax,
        total: newTotal
      }
    });

    // Record voucher redemption
    const redemption = await prisma.voucherRedemption.create({
      data: {
        voucher: {
          connect: { id: voucher.id }
        },
        order: {
          connect: { id: orderId }
        },
        user: {
          connect: { id: req.user.id }
        }
      }
    });

    // Increment voucher usage count
    await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        usageCount: {
          increment: 1
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        redemption,
        discountAmount,
        order: {
          ...updatedOrder,
          discountApplied: discountAmount
        }
      },
      message: `Voucher applied successfully. Discount: $${discountAmount.toFixed(2)}`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove a voucher from an order
 * @route   DELETE /api/vouchers/remove/:orderId
 * @access  Private/Manager/Admin
 */
exports.removeVoucher = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    // Check if order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        restaurant: true,
        voucherRedemptions: {
          include: {
            voucher: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user has access to this order
    if (
      req.user.role !== 'ADMIN' &&
      order.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this order'
      });
    }

    // Check if there's a voucher applied
    if (order.voucherRedemptions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No voucher applied to this order'
      });
    }

    // Get the voucher redemption details
    const redemption = order.voucherRedemptions[0];
    const voucher = redemption.voucher;

    // Calculate the original subtotal before voucher was applied
    let originalSubtotal = order.subtotal;
    let discountAmount = 0;

    if (voucher.type === 'PERCENTAGE') {
      // If it was a percentage discount, calculate from the current subtotal
      // S = original subtotal * (1 - discount/100)
      // So original subtotal = S / (1 - discount/100)
      const discountFactor = 1 - voucher.value / 100;
      originalSubtotal = order.subtotal / discountFactor;
      discountAmount = originalSubtotal - order.subtotal;
    } else if (voucher.type === 'FIXED_AMOUNT' || voucher.type === 'FREE_ITEM') {
      // For fixed or free item, add the value back
      originalSubtotal = order.subtotal + voucher.value;
      discountAmount = voucher.value;
    }

    // Round to 2 decimal places
    originalSubtotal = Math.round(originalSubtotal * 100) / 100;
    discountAmount = Math.round(discountAmount * 100) / 100;

    // Calculate new totals
    const taxRate = order.restaurant.taxRate || 0;
    const newTax = (originalSubtotal * taxRate) / 100;
    const newTotal = originalSubtotal + newTax + (order.tip || 0);

    // Update order with original totals
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal: originalSubtotal,
        tax: newTax,
        total: newTotal
      }
    });

    // Delete voucher redemption
    await prisma.voucherRedemption.delete({
      where: { id: redemption.id }
    });

    // Decrement voucher usage count
    await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        usageCount: {
          decrement: 1
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        order: updatedOrder,
        discountRemoved: discountAmount
      },
      message: `Voucher removed successfully. Original price restored.`
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to generate a unique voucher code
function generateVoucherCode() {
  // Create a random 6-character alphanumeric code
  // Uses more characters for better randomness
  return 'PROMO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}