const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getPayments,
  getPayment,
  createPayment,
  refundPayment,
  getOrderPaymentSummary
} = require('../controllers/paymentController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Payment validation
const paymentValidation = [
  body('orderId')
    .isUUID()
    .withMessage('Valid order ID is required'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than zero'),
  body('method')
    .isIn(['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'MOBILE_PAYMENT', 'GIFT_CARD', 'OTHER'])
    .withMessage('Invalid payment method')
];

// Routes
router
  .route('/')
  .get(authorize('ADMIN', 'MANAGER'), getPayments)
  .post(paymentValidation, createPayment);

router
  .route('/:id')
  .get(getPayment);

router
  .route('/:id/refund')
  .post(
    authorize('ADMIN', 'MANAGER'),
    body('reason')
      .notEmpty()
      .withMessage('Reason for refund is required'),
    refundPayment
  );

router
  .route('/order/:orderId/summary')
  .get(getOrderPaymentSummary);

module.exports = router;