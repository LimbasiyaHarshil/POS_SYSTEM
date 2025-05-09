const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getShifts,
  getShift,
  createShift,
  updateShift,
  clockInOut,
  getCurrentShift
} = require('../controllers/shiftController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Shift validation
const shiftValidation = [
  body('startTime')
    .isISO8601()
    .withMessage('Valid start time is required (ISO format)'),
  body('status')
    .optional()
    .isIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
    .withMessage('Invalid status')
];

// Clock in/out validation
const clockValidation = [
  body('action')
    .isIn(['IN', 'OUT'])
    .withMessage("Action must be 'IN' or 'OUT'"),
  body('type')
    .optional()
    .isIn(['REGULAR', 'BREAK', 'TRAINING', 'OVERTIME'])
    .withMessage('Invalid time entry type')
];

// Routes
router
  .route('/')
  .get(getShifts)
  .post(shiftValidation, createShift);

router.route('/current').get(getCurrentShift);

router
  .route('/:id')
  .get(getShift)
  .put(updateShift);

router
  .route('/:id/clock')
  .post(clockValidation, clockInOut);

module.exports = router;