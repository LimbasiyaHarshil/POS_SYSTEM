const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getRestaurants,
  getRestaurant,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
  getRestaurantStats
} = require('../controllers/restaurantController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Restaurant validation
const restaurantValidation = [
  body('name')
    .notEmpty()
    .withMessage('Restaurant name is required'),
  body('address')
    .notEmpty()
    .withMessage('Address is required'),
  body('phone')
    .notEmpty()
    .withMessage('Phone number is required'),
  body('taxRate')
    .optional()
    .isFloat({ min: 0, max: 30 })
    .withMessage('Tax rate must be between 0 and 30 percent')
];

// Routes
router
  .route('/')
  .get(getRestaurants)
  .post(authorize('ADMIN'), restaurantValidation, createRestaurant);

router
  .route('/:id')
  .get(getRestaurant)
  .put(authorize('ADMIN', 'MANAGER'), restaurantValidation, updateRestaurant)
  .delete(authorize('ADMIN'), deleteRestaurant);

router
  .route('/:id/stats')
  .get(authorize('ADMIN', 'MANAGER'), getRestaurantStats);

module.exports = router;