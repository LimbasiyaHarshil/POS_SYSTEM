const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  addOrderItems,
  updateOrderItem,
  removeOrderItem,
  cancelOrder
} = require('../controllers/orderController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Order creation validation
const orderValidation = [
  body('type')
    .optional()
    .isIn(['DINE_IN', 'TAKEOUT', 'DELIVERY', 'ONLINE'])
    .withMessage('Invalid order type'),
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Order must have at least one item'),
  body('orderItems.*.menuItemId')
    .isUUID()
    .withMessage('Valid menu item ID is required'),
  body('orderItems.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer')
];

// Order item validation
const orderItemValidation = [
  body('orderItems')
    .isArray({ min: 1 })
    .withMessage('Must provide at least one order item'),
  body('orderItems.*.menuItemId')
    .isUUID()
    .withMessage('Valid menu item ID is required'),
  body('orderItems.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer')
];

// Routes
router
  .route('/')
  .get(getOrders)
  .post(orderValidation, createOrder);

router.route('/:id')
  .get(getOrder);

router
  .route('/:id/status')
  .put(
    body('status')
      .isIn(['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'])
      .withMessage('Invalid status'),
    updateOrderStatus
  );

router
  .route('/:id/items')
  .post(orderItemValidation, addOrderItems);

router
  .route('/:orderId/items/:itemId')
  .put(
    body('quantity')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Quantity must be a positive integer'),
    updateOrderItem
  )
  .delete(removeOrderItem);

router
  .route('/:id/cancel')
  .put(authorize('ADMIN', 'MANAGER'), cancelOrder);

module.exports = router;