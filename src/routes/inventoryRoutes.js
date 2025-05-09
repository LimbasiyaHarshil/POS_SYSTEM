const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  adjustInventory,
  getLowStockItems,
  getMenuItemInventoryUsage,
  updateMenuItemInventoryUsage
} = require('../controllers/inventoryController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);
// Only allow managers and admins to access inventory routes
router.use(authorize('ADMIN', 'MANAGER'));

// Inventory item validation
const inventoryItemValidation = [
  body('name')
    .notEmpty()
    .withMessage('Inventory item name is required'),
  body('unitType')
    .notEmpty()
    .withMessage('Unit type is required'),
  body('quantity')
    .isFloat({ min: 0 })
    .withMessage('Quantity must be zero or positive')
];

// Inventory adjustment validation
const adjustmentValidation = [
  body('adjustment')
    .isFloat()
    .withMessage('Adjustment must be a number'),
  body('reason')
    .notEmpty()
    .withMessage('Reason for adjustment is required')
];

// Inventory usage validation
const inventoryUsageValidation = [
  body('inventoryUsages')
    .isArray()
    .withMessage('Inventory usages must be an array'),
  body('inventoryUsages.*.inventoryItemId')
    .isUUID()
    .withMessage('Valid inventory item ID is required'),
  body('inventoryUsages.*.quantity')
    .isFloat({ min: 0.01 })
    .withMessage('Quantity must be greater than zero')
];

// Routes
router
  .route('/')
  .get(getInventoryItems)
  .post(inventoryItemValidation, createInventoryItem);

router.route('/low-stock').get(getLowStockItems);

router
  .route('/:id')
  .get(getInventoryItem)
  .put(inventoryItemValidation, updateInventoryItem)
  .delete(deleteInventoryItem);

router
  .route('/:id/adjust')
  .post(adjustmentValidation, adjustInventory);

router
  .route('/usage/:menuItemId')
  .get(getMenuItemInventoryUsage)
  .put(inventoryUsageValidation, updateMenuItemInventoryUsage);

module.exports = router;