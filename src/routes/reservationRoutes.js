const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getReservations,
  getReservation,
  createReservation,
  updateReservation,
  deleteReservation,
  checkAvailability
} = require('../controllers/reservationController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Reservation validation
const reservationValidation = [
  body('customerId')
    .isUUID()
    .withMessage('Valid customer ID is required'),
  body('reservationTime')
    .isISO8601()
    .withMessage('Valid reservation time is required (ISO format)'),
  body('partySize')
    .isInt({ min: 1 })
    .withMessage('Party size must be a positive integer'),
  body('status')
    .optional()
    .isIn(['CONFIRMED', 'CANCELLED', 'SEATED', 'COMPLETED', 'NO_SHOW'])
    .withMessage('Invalid status')
];

// Routes
router
  .route('/')
  .get(getReservations)
  .post(reservationValidation, createReservation);

router
  .route('/check-availability')
  .get(checkAvailability);

router
  .route('/:id')
  .get(getReservation)
  .put(
    body('reservationTime')
      .optional()
      .isISO8601()
      .withMessage('Valid reservation time is required (ISO format)'),
    body('partySize')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Party size must be a positive integer'),
    body('status')
      .optional()
      .isIn(['CONFIRMED', 'CANCELLED', 'SEATED', 'COMPLETED', 'NO_SHOW'])
      .withMessage('Invalid status'),
    updateReservation
  )
  .delete(authorize('ADMIN', 'MANAGER'), deleteReservation);

module.exports = router;