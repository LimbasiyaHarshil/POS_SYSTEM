const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerOrders,
  adjustLoyaltyPoints
} = require('../controllers/customerController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Customer validation
const customerValidation = [
  body('firstName')
    .notEmpty()
    .withMessage('First name is required'),
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .notEmpty()
    .withMessage('Phone cannot be empty if provided')
];

// Routes
router
  .route('/')
  .get(getCustomers)
  .post(customerValidation, createCustomer);

router
  .route('/:id')
  .get(getCustomer)
  .put(customerValidation, updateCustomer)
  .delete(authorize('ADMIN', 'MANAGER'), deleteCustomer);

router
  .route('/:id/orders')
  .get(getCustomerOrders);

router
  .route('/:id/loyalty-points')
  .put(
    authorize('ADMIN', 'MANAGER'),
    body('adjustment')
      .isInt()
      .withMessage('Adjustment must be an integer'),
    body('reason')
      .notEmpty()
      .withMessage('Reason for adjustment is required'),
    adjustLoyaltyPoints
  );

module.exports = router;