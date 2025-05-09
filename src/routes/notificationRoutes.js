const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification,
  deleteNotification
} = require('../controllers/notificationController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Notification validation
const notificationValidation = [
  body('title')
    .notEmpty()
    .withMessage('Title is required'),
  body('message')
    .notEmpty()
    .withMessage('Message is required'),
  body('priority')
    .optional()
    .isIn(['LOW', 'MEDIUM', 'HIGH'])
    .withMessage('Invalid priority')
];

// Routes
router
  .route('/')
  .get(getNotifications)
  .post(
    authorize('ADMIN', 'MANAGER'),
    notificationValidation,
    createNotification
  );

router
  .route('/mark-all-read')
  .put(markAllAsRead);

router
  .route('/:id/read')
  .put(markAsRead);

router
  .route('/:id')
  .delete(deleteNotification);

module.exports = router;