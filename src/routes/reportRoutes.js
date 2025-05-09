const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getSalesReport,
  getInventoryUsageReport,
  getStaffPerformanceReport
} = require('../controllers/reportController');

const router = express.Router();

// Apply protection to all routes
router.use(protect);
// Only allow managers and admins to access report routes
router.use(authorize('ADMIN', 'MANAGER'));

// Routes
router.get('/sales', getSalesReport);
router.get('/inventory-usage', getInventoryUsageReport);
router.get('/staff-performance', getStaffPerformanceReport);

module.exports = router;