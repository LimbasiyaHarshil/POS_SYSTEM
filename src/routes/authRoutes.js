const express = require('express');
const { body } = require('express-validator');
const {
  register,
  login,
  getMe,
  changePassword,
  logout
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const authSessionService = require('../services/authSessionService');

const router = express.Router();

// Register validation
const registerValidation = [
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
    .withMessage('Last name is required')
];

// Login validation
const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Change password validation
const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
];

// Routes
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePasswordValidation, changePassword);

// Fixed logout route - properly using validation in array
router.post('/logout', protect, [
  body('sessionId')
    .notEmpty()
    .withMessage('Session ID is required')
], logout);

router.get('/sessions', protect, async (req, res, next) => {
  try {
    const { active } = req.query;
    const userId = req.user.id;
    
    let sessions;
    if (active === 'true') {
      sessions = await authSessionService.getActiveSessions(userId);
    } else {
      sessions = await authSessionService.getSessionHistory(userId);
    }
    
    res.status(200).json({
      success: true,
      count: sessions.length,
      data: sessions
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sessions/logout-all', protect, async (req, res, next) => {
  try {
    await authSessionService.endAllUserSessions(req.user.id);
    
    res.status(200).json({
      success: true,
      message: 'Logged out of all devices',
      logoutTime: new Date()
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;