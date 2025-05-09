const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * @desc    Get all gift cards
 * @route   GET /api/gift-cards
 * @access  Private/Manager/Admin
 */
exports.getGiftCards = async (req, res, next) => {
  try {
    const { 
      restaurantId, 
      customerId, 
      isActive,
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

    // Filter by customer
    if (customerId) {
      where.customerId = customerId;
    }

    // Filter by active status
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Filter by code
    if (code) {
      where.code = code;
    }
    
    // Get gift cards count for pagination
    const totalGiftCards = await prisma.giftCard.count({
      where
    });

    // Get gift cards with pagination
    const giftCards = await prisma.giftCard.findMany({
      where,
      include: {
        issuedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        transactions: {
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
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
      count: giftCards.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalGiftCards,
        pages: Math.ceil(totalGiftCards / parseInt(limit))
      },
      data: giftCards
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single gift card
 * @route   GET /api/gift-cards/:id
 * @access  Private
 */
exports.getGiftCard = async (req, res, next) => {
  try {
    const { id } = req.params;

    const giftCard = await prisma.giftCard.findUnique({
      where: { id },
      include: {
        issuedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        },
        transactions: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true
              }
            },
            payment: {
              select: {
                id: true,
                amount: true,
                method: true,
                order: {
                  select: {
                    id: true,
                    orderNumber: true
                  }
                }
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: 'Gift card not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      giftCard.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this gift card'
      });
    }

    // Check if gift card is expired
    const isExpired = giftCard.expiryDate && new Date(giftCard.expiryDate) < new Date();

    res.status(200).json({
      success: true,
      data: {
        ...giftCard,
        isExpired
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a gift card
 * @route   POST /api/gift-cards
 * @access  Private/Manager/Admin
 */
exports.createGiftCard = async (req, res, next) => {
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
      initialBalance, 
      customerId, 
      expiryDate, 
      code 
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

    // Check customer exists if provided
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

    // Generate code if not provided
    const giftCardCode = code || generateGiftCardCode();

    // Check if code already exists
    const existingGiftCard = await prisma.giftCard.findFirst({
      where: {
        code: giftCardCode,
        restaurantId
      }
    });

    if (existingGiftCard) {
      return res.status(400).json({
        success: false,
        message: 'Gift card code already exists'
      });
    }

    // Create gift card
    const giftCard = await prisma.giftCard.create({
      data: {
        code: giftCardCode,
        initialBalance,
        currentBalance: initialBalance,
        isActive: true,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        restaurant: {
          connect: { id: restaurantId }
        },
        issuedTo: customerId ? {
          connect: { id: customerId }
        } : undefined
      }
    });

    // Record the issuance transaction
    await prisma.giftCardTransaction.create({
      data: {
        amount: initialBalance,
        type: 'ISSUE',
        notes: 'Gift card issued',
        giftCard: {
          connect: { id: giftCard.id }
        },
        user: {
          connect: { id: req.user.id }
        }
      }
    });

    // Get the complete gift card with relations
    const createdGiftCard = await prisma.giftCard.findUnique({
      where: { id: giftCard.id },
      include: {
        issuedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        transactions: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: createdGiftCard
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Redeem gift card (use for payment)
 * @route   POST /api/gift-cards/redeem
 * @access  Private
 */
exports.redeemGiftCard = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { code, amount, orderId } = req.body;
    
    // Find gift card by code
    const giftCard = await prisma.giftCard.findFirst({
      where: {
        code,
        restaurantId: req.user.restaurantId
      }
    });

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: 'Gift card not found'
      });
    }

    // Check if gift card is active
    if (!giftCard.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Gift card is inactive'
      });
    }

    // Check if gift card is expired
    if (giftCard.expiryDate && new Date(giftCard.expiryDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Gift card is expired'
      });
    }

    // Check if gift card has sufficient balance
    if (giftCard.currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Current balance: ${giftCard.currentBalance}`
      });
    }

    // Check if order exists if provided
    let order = null;
    if (orderId) {
      order = await prisma.order.findUnique({
        where: { id: orderId }
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }

      // Check if order belongs to the same restaurant
      if (order.restaurantId !== req.user.restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to process payment for this order'
        });
      }
    }

    // Create payment record if order is provided
    let payment = null;
    if (order) {
      payment = await prisma.payment.create({
        data: {
          amount,
          method: 'GIFT_CARD',
          status: 'COMPLETED',
          order: {
            connect: { id: orderId }
          },
          user: {
            connect: { id: req.user.id }
          }
        }
      });
    }

    // Update gift card balance
    const updatedGiftCard = await prisma.giftCard.update({
      where: { id: giftCard.id },
      data: {
        currentBalance: {
          decrement: amount
        },
        // If balance is now 0, deactivate the card
        isActive: giftCard.currentBalance - amount > 0
      }
    });

    // Record the redemption transaction
    const transaction = await prisma.giftCardTransaction.create({
      data: {
        amount: amount,
        type: 'REDEEM',
        notes: orderId ? `Redeemed for order ${order.orderNumber}` : 'Redeemed',
        giftCard: {
          connect: { id: giftCard.id }
        },
        payment: payment ? {
          connect: { id: payment.id }
        } : undefined,
        user: {
          connect: { id: req.user.id }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        giftCard: updatedGiftCard,
        transaction,
        payment,
        remainingBalance: updatedGiftCard.currentBalance
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add funds to gift card
 * @route   POST /api/gift-cards/:id/add-funds
 * @access  Private/Manager/Admin
 */
exports.addFunds = async (req, res, next) => {
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
    const { amount, notes } = req.body;

    // Check if gift card exists
    const giftCard = await prisma.giftCard.findUnique({
      where: { id }
    });

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: 'Gift card not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      giftCard.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this gift card'
      });
    }

    // Update gift card balance and activate if inactive
    const updatedGiftCard = await prisma.giftCard.update({
      where: { id },
      data: {
        currentBalance: {
          increment: amount
        },
        isActive: true
      }
    });

    // Record the transaction
    const transaction = await prisma.giftCardTransaction.create({
      data: {
        amount,
        type: 'LOAD',
        notes: notes || 'Added funds',
        giftCard: {
          connect: { id }
        },
        user: {
          connect: { id: req.user.id }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        giftCard: updatedGiftCard,
        transaction,
        message: `Successfully added ${amount} to gift card`
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update gift card status
 * @route   PUT /api/gift-cards/:id/status
 * @access  Private/Manager/Admin
 */
exports.updateGiftCardStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive field is required'
      });
    }

    // Check if gift card exists
    const giftCard = await prisma.giftCard.findUnique({
      where: { id }
    });

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: 'Gift card not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      giftCard.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this gift card'
      });
    }

    // Update gift card status
    const updatedGiftCard = await prisma.giftCard.update({
      where: { id },
      data: {
        isActive: isActive === true
      }
    });

    const action = isActive ? 'activated' : 'deactivated';

    // Record the transaction if deactivating
    if (!isActive) {
      await prisma.giftCardTransaction.create({
        data: {
          amount: 0,
          type: 'ISSUE', // Using ISSUE type for status changes
          notes: `Gift card ${action}`,
          giftCard: {
            connect: { id }
          },
          user: {
            connect: { id: req.user.id }
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      data: updatedGiftCard,
      message: `Gift card ${action} successfully`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Check gift card balance
 * @route   GET /api/gift-cards/check-balance/:code
 * @access  Public
 */
exports.checkBalance = async (req, res, next) => {
  try {
    const { code } = req.params;

    // Find gift card by code
    const giftCard = await prisma.giftCard.findFirst({
      where: {
        code
      },
      include: {
        restaurant: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!giftCard) {
      return res.status(404).json({
        success: false,
        message: 'Gift card not found'
      });
    }

    const isExpired = giftCard.expiryDate && new Date(giftCard.expiryDate) < new Date();

    res.status(200).json({
      success: true,
      data: {
        code: giftCard.code,
        initialBalance: giftCard.initialBalance,
        currentBalance: giftCard.currentBalance,
        isActive: giftCard.isActive,
        isExpired,
        expiryDate: giftCard.expiryDate,
        restaurant: giftCard.restaurant.name
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to generate a unique gift card code
function generateGiftCardCode() {
  // Create a random code with a combination of letters and numbers
  // Format: XXXX-XXXX-XXXX (where X is alphanumeric)
  const segment1 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const segment2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const segment3 = crypto.randomBytes(2).toString('hex').toUpperCase();
  
  return `${segment1}-${segment2}-${segment3}`;
}