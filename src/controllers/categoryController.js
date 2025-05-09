const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all categories
 * @route   GET /api/menu/categories
 * @access  Private
 */
exports.getCategories = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;

    // Build filter condition
    const where = {};
    
    // Filter by restaurant
    if (restaurantId) {
      where.restaurantId = restaurantId;
    } else if (req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }

    // Get only top-level categories if specified
    if (req.query.topLevel === 'true') {
      where.parentId = null;
    }

    // Get only active categories if specified
    if (req.query.active === 'true') {
      where.active = true;
    }

    const categories = await prisma.category.findMany({
      where,
      include: {
        parent: {
          select: {
            id: true,
            name: true
          }
        },
        children: {
          select: {
            id: true,
            name: true,
            description: true,
            active: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single category
 * @route   GET /api/menu/categories/:id
 * @access  Private
 */
exports.getCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        parent: {
          select: {
            id: true,
            name: true
          }
        },
        children: {
          select: {
            id: true,
            name: true,
            description: true,
            active: true
          }
        },
        menuItems: {
          where: {
            available: true
          },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            image: true
          }
        }
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      category.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this category'
      });
    }

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a category
 * @route   POST /api/menu/categories
 * @access  Private/Manager/Admin
 */
exports.createCategory = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { name, description, parentId, active } = req.body;
    let { restaurantId } = req.body;

    // If not admin, can only create for own restaurant
    if (req.user.role !== 'ADMIN') {
      restaurantId = req.user.restaurantId;
    }

    // Check restaurant exists
    if (restaurantId) {
      const restaurant = await prisma.restaurant.findUnique({
        where: { id: restaurantId }
      });

      if (!restaurant) {
        return res.status(404).json({
          success: false,
          message: 'Restaurant not found'
        });
      }
    }

    // Check if parent category exists
    if (parentId) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: parentId }
      });

      if (!parentCategory) {
        return res.status(404).json({
          success: false,
          message: 'Parent category not found'
        });
      }

      // Parent category must be in the same restaurant
      if (parentCategory.restaurantId !== restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Parent category must be in the same restaurant'
        });
      }
    }

    // Create category
    const category = await prisma.category.create({
      data: {
        name,
        description,
        active: active !== undefined ? active : true,
        parent: parentId ? {
          connect: { id: parentId }
        } : undefined,
        restaurant: {
          connect: { id: restaurantId }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a category
 * @route   PUT /api/menu/categories/:id
 * @access  Private/Manager/Admin
 */
exports.updateCategory = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { id } = req.params;
    const { name, description, parentId, active } = req.body;

    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      category.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this category'
      });
    }

    // Check if parent category exists
    if (parentId && parentId !== category.parentId) {
      const parentCategory = await prisma.category.findUnique({
        where: { id: parentId }
      });

      if (!parentCategory) {
        return res.status(404).json({
          success: false,
          message: 'Parent category not found'
        });
      }

      // Parent category must be in the same restaurant
      if (parentCategory.restaurantId !== category.restaurantId) {
        return res.status(400).json({
          success: false,
          message: 'Parent category must be in the same restaurant'
        });
      }

      // Check for circular reference - parent cannot be a descendant
      if (parentId === id) {
        return res.status(400).json({
          success: false,
          message: 'Category cannot be its own parent'
        });
      }

      // Check deeper levels of hierarchy for circular reference
      let testParent = parentCategory;
      while (testParent.parentId) {
        if (testParent.parentId === id) {
          return res.status(400).json({
            success: false,
            message: 'Cannot create circular reference in category hierarchy'
          });
        }
        
        testParent = await prisma.category.findUnique({
          where: { id: testParent.parentId }
        });
      }
    }

    // Build update data
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (active !== undefined) updateData.active = active;

    // Handle parent relationship
    if (parentId === null) {
      updateData.parent = {
        disconnect: true
      };
    } else if (parentId) {
      updateData.parent = {
        connect: { id: parentId }
      };
    }

    // Update category
    const updatedCategory = await prisma.category.update({
      where: { id },
      data: updateData,
      include: {
        parent: {
          select: {
            id: true,
            name: true
          }
        },
        children: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: updatedCategory
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a category
 * @route   DELETE /api/menu/categories/:id
 * @access  Private/Manager/Admin
 */
exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if category exists
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        menuItems: true
      }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      category.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this category'
      });
    }

    // Check if category has child categories
    if (category.children.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with child categories'
      });
    }

    // Check if category has menu items
    if (category.menuItems.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category with menu items'
      });
    }

    // Delete category
    await prisma.category.delete({
      where: { id }
    });

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};