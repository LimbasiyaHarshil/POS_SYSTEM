const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getTables,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  changeTableStatus
} = require('../controllers/tableController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Table validation
const tableValidation = [
  body('number')
    .isInt({ min: 1 })
    .withMessage('Table number must be a positive integer'),
  body('capacity')
    .isInt({ min: 1 })
    .withMessage('Capacity must be a positive integer'),
  body('status')
    .optional()
    .isIn(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'])
    .withMessage('Invalid status. Must be AVAILABLE, OCCUPIED, RESERVED, or MAINTENANCE')
];

// Routes
router
  .route('/')
  .get(getTables)
  .post(
    authorize('ADMIN', 'MANAGER'), 
    tableValidation, 
    createTable
  );

router
  .route('/:id')
  .get(getTable)
  .put(
    authorize('ADMIN', 'MANAGER'), 
    tableValidation, 
    updateTable
  )
  .delete(
    authorize('ADMIN', 'MANAGER'), 
    deleteTable
  );

router
  .route('/:id/status')
  .put(
    body('status')
      .isIn(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'])
      .withMessage('Invalid status. Must be AVAILABLE, OCCUPIED, RESERVED, or MAINTENANCE'),
    changeTableStatus
  );

module.exports = router;