const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getGiftCards,
  getGiftCard,
  createGiftCard,
  redeemGiftCard,
  addFunds,
  updateGiftCardStatus,
  checkBalance
} = require('../controllers/giftCardController');

const router = express.Router();

// Apply protection to all routes except check-balance
router.use(protect);

// Gift card validation
const giftCardValidation = [
  body('initialBalance')
    .isFloat({ min: 1 })
    .withMessage('Initial balance must be greater than 0'),
  body('expiryDate')
    .optional()
    .isISO8601()
    .withMessage('Valid expiry date is required (ISO format)')
];

// Redemption validation
const redemptionValidation = [
  body('code')
    .notEmpty()
    .withMessage('Gift card code is required'),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0')
];

// Routes
router
  .route('/')
  .get(authorize('ADMIN', 'MANAGER'), getGiftCards)
  .post(authorize('ADMIN', 'MANAGER'), giftCardValidation, createGiftCard);

router
  .route('/redeem')
  .post(redemptionValidation, redeemGiftCard);

// Public route for checking balance
router.get('/check-balance/:code', (req, res, next) => {
  req.user = { role: 'PUBLIC' }; // Hack to bypass protection
  next();
}, checkBalance);

router
  .route('/:id')
  .get(getGiftCard);

router
  .route('/:id/add-funds')
  .post(
    authorize('ADMIN', 'MANAGER'),
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Amount must be greater than 0'),
    addFunds
  );

router
  .route('/:id/status')
  .put(
    authorize('ADMIN', 'MANAGER'),
    body('isActive')
      .isBoolean()
      .withMessage('isActive must be a boolean'),
    updateGiftCardStatus
  );

module.exports = router;