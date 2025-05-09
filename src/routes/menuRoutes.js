const express = require('express');
const { body } = require('express-validator');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { 
  getCategories, 
  getCategory, 
  createCategory, 
  updateCategory, 
  deleteCategory 
} = require('../controllers/categoryController');
const {
  getMenuItems,
  getMenuItem,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem
} = require('../controllers/menuItemController');
const {
  getModifierGroups,
  getModifierGroup,
  createModifierGroup,
  updateModifierGroup,
  deleteModifierGroup,
  getModifiers,
  createModifier,
  updateModifier,
  deleteModifier
} = require('../controllers/modifierController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);

// Category validation
const categoryValidation = [
  body('name')
    .notEmpty()
    .withMessage('Category name is required'),
  body('restaurantId')
    .optional()
    .isUUID()
    .withMessage('Invalid restaurant ID')
];

// Menu item validation
const menuItemValidation = [
  body('name')
    .notEmpty()
    .withMessage('Menu item name is required'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('categoryId')
    .isUUID()
    .withMessage('Valid category ID is required'),
  body('restaurantId')
    .optional()
    .isUUID()
    .withMessage('Invalid restaurant ID')
];

// Modifier group validation
const modifierGroupValidation = [
  body('name')
    .notEmpty()
    .withMessage('Modifier group name is required')
];

// Modifier validation
const modifierValidation = [
  body('name')
    .notEmpty()
    .withMessage('Modifier name is required'),
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('modifierGroupId')
    .isUUID()
    .withMessage('Valid modifier group ID is required')
];

// Category routes
router
  .route('/categories')
  .get(getCategories)
  .post(
    authorize('ADMIN', 'MANAGER'), 
    categoryValidation, 
    createCategory
  );

router
  .route('/categories/:id')
  .get(getCategory)
  .put(
    authorize('ADMIN', 'MANAGER'), 
    categoryValidation, 
    updateCategory
  )
  .delete(
    authorize('ADMIN', 'MANAGER'), 
    deleteCategory
  );

// Menu item routes
router
  .route('/items')
  .get(getMenuItems)
  .post(
    authorize('ADMIN', 'MANAGER'), 
    menuItemValidation, 
    createMenuItem
  );

router
  .route('/items/:id')
  .get(getMenuItem)
  .put(
    authorize('ADMIN', 'MANAGER'), 
    menuItemValidation, 
    updateMenuItem
  )
  .delete(
    authorize('ADMIN', 'MANAGER'), 
    deleteMenuItem
  );

// Modifier group routes
router
  .route('/modifier-groups')
  .get(getModifierGroups)
  .post(
    authorize('ADMIN', 'MANAGER'), 
    modifierGroupValidation, 
    createModifierGroup
  );

router
  .route('/modifier-groups/:id')
  .get(getModifierGroup)
  .put(
    authorize('ADMIN', 'MANAGER'), 
    modifierGroupValidation, 
    updateModifierGroup
  )
  .delete(
    authorize('ADMIN', 'MANAGER'), 
    deleteModifierGroup
  );

// Modifier routes
router
  .route('/modifiers')
  .get(getModifiers)
  .post(
    authorize('ADMIN', 'MANAGER'), 
    modifierValidation, 
    createModifier
  );

router
  .route('/modifiers/:id')
  .put(
    authorize('ADMIN', 'MANAGER'), 
    modifierValidation, 
    updateModifier
  )
  .delete(
    authorize('ADMIN', 'MANAGER'), 
    deleteModifier
  );

module.exports = router;