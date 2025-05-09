const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getKitchenOrders,
  updateOrderItemStatus,
  updateKitchenOrderStatus,
  getKitchenStats
} = require('../controllers/kitchenController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);
// Allow kitchen staff, managers and admins
router.use(authorize('KITCHEN', 'MANAGER', 'ADMIN'));

// Routes
router.route('/orders').get(getKitchenOrders);

router
  .route('/orders/:id/status')
  .put(
    body('status')
      .isIn(['PREPARING', 'READY'])
      .withMessage('Invalid status. Kitchen can only set orders to PREPARING or READY'),
    updateKitchenOrderStatus
  );

router
  .route('/order-items/:id/status')
  .put(
    body('status')
      .isIn(['PENDING', 'PREPARING', 'READY', 'SERVED'])
      .withMessage('Invalid status'),
    updateOrderItemStatus
  );

router.route('/stats').get(getKitchenStats);

module.exports = router;