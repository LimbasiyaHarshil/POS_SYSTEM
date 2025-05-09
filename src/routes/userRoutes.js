const express = require('express');
const { body } = require('express-validator');
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

// Create user validation
const createUserValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('firstName')
    .notEmpty()
    .withMessage('First name is required'),
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required'),
  body('role')
    .isIn(['ADMIN', 'MANAGER', 'SERVER', 'KITCHEN'])
    .withMessage('Invalid role')
    .optional()
];

// Update user validation
const updateUserValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .optional(),
  body('firstName')
    .notEmpty()
    .withMessage('First name is required')
    .optional(),
  body('lastName')
    .notEmpty()
    .withMessage('Last name is required')
    .optional(),
  body('role')
    .isIn(['ADMIN', 'MANAGER', 'SERVER', 'KITCHEN'])
    .withMessage('Invalid role')
    .optional(),
  body('active')
    .isBoolean()
    .withMessage('Active must be a boolean')
    .optional()
];

// Apply middleware to all routes
router.use(protect);

// Routes
router
  .route('/')
  .get(authorize('ADMIN', 'MANAGER'), getUsers)
  .post(authorize('ADMIN', 'MANAGER'), createUserValidation, createUser);

router
  .route('/:id')
  .get(getUser)
  .put(updateUserValidation, updateUser)
  .delete(authorize('ADMIN', 'MANAGER'), deleteUser);

module.exports = router;