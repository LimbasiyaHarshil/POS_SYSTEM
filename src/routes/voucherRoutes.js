const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getVouchers,
  getVoucher,
  createVoucher,
  updateVoucher,
  validateVoucher,
  applyVoucher,
  removeVoucher
} = require('../controllers/voucherController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Voucher validation
const voucherValidation = [
  body('type')
    .isIn(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_ITEM'])
    .withMessage('Invalid voucher type'),
  body('value')
    .isFloat({ min: 0 })
    .withMessage('Value must be a positive number'),
  body('startDate')
    .isISO8601()
    .withMessage('Valid start date is required (ISO format)'),
  body('expiryDate')
    .isISO8601()
    .withMessage('Valid expiry date is required (ISO format)')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('Expiry date must be after start date');
      }
      return true;
    })
];

// Routes
router
  .route('/')
  .get(getVouchers)
  .post(authorize('ADMIN', 'MANAGER'), voucherValidation, createVoucher);

router
  .route('/validate')
  .post(validateVoucher);

router
  .route('/apply')
  .post(
    body('code')
      .notEmpty()
      .withMessage('Voucher code is required'),
    body('orderId')
      .isUUID()
      .withMessage('Valid order ID is required'),
    applyVoucher
  );

router
  .route('/remove/:orderId')
  .delete(authorize('ADMIN', 'MANAGER'), removeVoucher);

router
  .route('/:id')
  .get(getVoucher)
  .put(authorize('ADMIN', 'MANAGER'), updateVoucher);

module.exports = router;