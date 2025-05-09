const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all shifts
 * @route   GET /api/shifts
 * @access  Private/Manager/Admin
 */
exports.getShifts = async (req, res, next) => {
  try {
    const { 
      restaurantId, 
      userId, 
      status, 
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter condition
    const where = {};
    
    // Filter by restaurant
    if (restaurantId) {
      where.restaurantId = restaurantId;
    } else if (req.user.restaurantId) {
      where.restaurantId = req.user.restaurantId;
    }

    // Filter by user
    if (userId) {
      where.userId = userId;
    } else if (req.user.role === 'SERVER' || req.user.role === 'KITCHEN') {
      // Regular employees can only see their own shifts
      where.userId = req.user.id;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by date range
    if (startDate || endDate) {
      where.startTime = {};
      
      if (startDate) {
        where.startTime.gte = new Date(startDate);
      }
      
      if (endDate) {
        where.startTime.lte = new Date(endDate);
      }
    }
    
    // Get shifts count for pagination
    const totalShifts = await prisma.shift.count({
      where
    });

    // Get shifts with pagination
    const shifts = await prisma.shift.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        timeEntries: true
      },
      orderBy: {
        startTime: 'desc'
      },
      skip,
      take: parseInt(limit)
    });

    // Calculate shift durations and additional stats
    const shiftsWithDuration = shifts.map(shift => {
      // Calculate duration in minutes
      let duration = null;
      if (shift.endTime) {
        duration = Math.round((new Date(shift.endTime) - new Date(shift.startTime)) / (1000 * 60));
      }

      // Calculate total time worked (excluding breaks)
      let workedMinutes = 0;
      shift.timeEntries.forEach(entry => {
        if (entry.clockOutTime && entry.type === 'REGULAR') {
          workedMinutes += Math.round((new Date(entry.clockOutTime) - new Date(entry.clockInTime)) / (1000 * 60));
        }
      });

      // Calculate break time
      let breakMinutes = 0;
      shift.timeEntries.forEach(entry => {
        if (entry.clockOutTime && entry.type === 'BREAK') {
          breakMinutes += Math.round((new Date(entry.clockOutTime) - new Date(entry.clockInTime)) / (1000 * 60));
        }
      });

      return {
        ...shift,
        duration,
        workedMinutes,
        breakMinutes
      };
    });

    res.status(200).json({
      success: true,
      count: shifts.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalShifts,
        pages: Math.ceil(totalShifts / parseInt(limit))
      },
      data: shiftsWithDuration
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single shift
 * @route   GET /api/shifts/:id
 * @access  Private
 */
exports.getShift = async (req, res, next) => {
  try {
    const { id } = req.params;

    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        timeEntries: {
          orderBy: {
            clockInTime: 'asc'
          }
        }
      }
    });

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found'
      });
    }

    // Check if user has access to this data
    if (req.user.role !== 'ADMIN' && 
        req.user.role !== 'MANAGER' && 
        shift.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this shift'
      });
    }

    // Calculate shift durations and additional stats
    let duration = null;
    if (shift.endTime) {
      duration = Math.round((new Date(shift.endTime) - new Date(shift.startTime)) / (1000 * 60));
    }

    // Calculate total time worked (excluding breaks)
    let workedMinutes = 0;
    shift.timeEntries.forEach(entry => {
      if (entry.clockOutTime && entry.type === 'REGULAR') {
        workedMinutes += Math.round((new Date(entry.clockOutTime) - new Date(entry.clockInTime)) / (1000 * 60));
      }
    });

    // Calculate break time
    let breakMinutes = 0;
    shift.timeEntries.forEach(entry => {
      if (entry.clockOutTime && entry.type === 'BREAK') {
        breakMinutes += Math.round((new Date(entry.clockOutTime) - new Date(entry.clockInTime)) / (1000 * 60));
      }
    });

    const shiftWithStats = {
      ...shift,
      duration,
      workedMinutes,
      breakMinutes,
      formattedWorkedTime: formatMinutesToHoursAndMinutes(workedMinutes),
      formattedBreakTime: formatMinutesToHoursAndMinutes(breakMinutes)
    };

    res.status(200).json({
      success: true,
      data: shiftWithStats
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a shift
 * @route   POST /api/shifts
 * @access  Private
 */
exports.createShift = async (req, res, next) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { 
      userId, 
      startTime, 
      endTime, 
      status, 
      notes 
    } = req.body;
    
    let { restaurantId } = req.body;

    // If not admin, can only create for own restaurant
    if (req.user.role !== 'ADMIN') {
      restaurantId = req.user.restaurantId;
    }

    // Managers can create shifts for any user in their restaurant
    // Regular employees can only create shifts for themselves
    let targetUserId = userId;
    if (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER') {
      targetUserId = req.user.id;
    }

    // Check if user exists and belongs to the restaurant
    const user = await prisma.user.findUnique({
      where: { id: targetUserId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.restaurantId !== restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to this restaurant'
      });
    }

    // Create shift
    const shift = await prisma.shift.create({
      data: {
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        status: status || 'IN_PROGRESS',
        notes,
        user: {
          connect: { id: targetUserId }
        },
        restaurant: {
          connect: { id: restaurantId }
        }
      }
    });

    // Create initial time entry if shift is in progress
    if (status === 'IN_PROGRESS' || !status) {
      await prisma.timeEntry.create({
        data: {
          clockInTime: new Date(startTime),
          type: 'REGULAR',
          shift: {
            connect: { id: shift.id }
          },
          user: {
            connect: { id: targetUserId }
          },
          restaurant: {
            connect: { id: restaurantId }
          }
        }
      });
    }

    // Get full shift details
    const createdShift = await prisma.shift.findUnique({
      where: { id: shift.id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        timeEntries: true
      }
    });

    res.status(201).json({
      success: true,
      data: createdShift
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a shift
 * @route   PUT /api/shifts/:id
 * @access  Private
 */
exports.updateShift = async (req, res, next) => {
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
    const { startTime, endTime, status, notes } = req.body;

    // Check if shift exists
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        timeEntries: {
          orderBy: {
            clockInTime: 'desc'
          },
          take: 1
        }
      }
    });

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found'
      });
    }

    // Check if user has access to update this shift
    if (req.user.role !== 'ADMIN' && 
        req.user.role !== 'MANAGER' && 
        shift.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this shift'
      });
    }
    
    if (req.user.role !== 'ADMIN' && shift.restaurantId !== req.user.restaurantId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this shift'
      });
    }

    // Build update data
    const updateData = {};
    if (startTime) updateData.startTime = new Date(startTime);
    if (notes !== undefined) updateData.notes = notes;
    
    // Handle status update and ending shifts
    if (status) {
      updateData.status = status;
      
      // If status changes to COMPLETED, set endTime if not provided
      if (status === 'COMPLETED' && !endTime && !shift.endTime) {
        updateData.endTime = new Date();
        
        // Also close any active time entries
        const latestTimeEntry = shift.timeEntries[0];
        if (latestTimeEntry && !latestTimeEntry.clockOutTime) {
          await prisma.timeEntry.update({
            where: { id: latestTimeEntry.id },
            data: { clockOutTime: new Date() }
          });
        }
      }
    }
    
    // If endTime is provided, update it
    if (endTime) {
      updateData.endTime = new Date(endTime);
    }

    // Update shift
    const updatedShift = await prisma.shift.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        timeEntries: {
          orderBy: {
            clockInTime: 'asc'
          }
        }
      }
    });

    // Calculate shift stats
    let duration = null;
    if (updatedShift.endTime) {
      duration = Math.round((new Date(updatedShift.endTime) - new Date(updatedShift.startTime)) / (1000 * 60));
    }

    res.status(200).json({
      success: true,
      data: {
        ...updatedShift,
        duration,
        formattedDuration: formatMinutesToHoursAndMinutes(duration)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clock in/out for a shift
 * @route   POST /api/shifts/:id/clock
 * @access  Private
 */
exports.clockInOut = async (req, res, next) => {
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
    const { action, type = 'REGULAR', notes } = req.body;

    // Check if shift exists
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        timeEntries: {
          orderBy: {
            clockInTime: 'desc'
          },
          take: 1
        }
      }
    });

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found'
      });
    }

    // Check if user has access to this shift
    if (shift.userId !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to clock in/out for this shift'
      });
    }
    
    // Can't clock in/out for completed or cancelled shifts
    if (shift.status === 'COMPLETED' || shift.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: `Cannot clock in/out for a ${shift.status.toLowerCase()} shift`
      });
    }

    let timeEntry;
    const now = new Date();
    
    // Handle clock-in
    if (action === 'IN') {
      // Check if there's an active time entry
      const activeEntry = shift.timeEntries.find(entry => !entry.clockOutTime);
      
      if (activeEntry) {
        return res.status(400).json({
          success: false,
          message: 'Already clocked in. Please clock out first.'
        });
      }
      
      // Create new time entry
      timeEntry = await prisma.timeEntry.create({
        data: {
          clockInTime: now,
          type,
          notes,
          shift: {
            connect: { id }
          },
          user: {
            connect: { id: shift.userId }
          },
          restaurant: {
            connect: { id: shift.restaurantId }
          }
        }
      });
      
      // If shift is SCHEDULED, change to IN_PROGRESS
      if (shift.status === 'SCHEDULED') {
        await prisma.shift.update({
          where: { id },
          data: { status: 'IN_PROGRESS' }
        });
      }
    } 
    // Handle clock-out
    else if (action === 'OUT') {
      // Find the latest active time entry
      const activeEntry = shift.timeEntries.find(entry => !entry.clockOutTime);
      
      if (!activeEntry) {
        return res.status(400).json({
          success: false,
          message: 'Not clocked in. Please clock in first.'
        });
      }
      
      // Update time entry with clock out time
      timeEntry = await prisma.timeEntry.update({
        where: { id: activeEntry.id },
        data: {
          clockOutTime: now,
          notes: notes || activeEntry.notes
        }
      });
      
      // If this is a regular time entry and the shift is ending, update the shift
      if (req.body.endShift && type === 'REGULAR') {
        await prisma.shift.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            endTime: now
          }
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "Action must be 'IN' or 'OUT'"
      });
    }

    // Get updated shift data
    const updatedShift = await prisma.shift.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          }
        },
        timeEntries: {
          orderBy: {
            clockInTime: 'desc'
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        timeEntry,
        shift: updatedShift,
        message: `Successfully clocked ${action.toLowerCase()}`
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current active shift for user
 * @route   GET /api/shifts/current
 * @access  Private
 */
exports.getCurrentShift = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Find active shift for user
    const activeShift = await prisma.shift.findFirst({
      where: {
        userId,
        status: 'IN_PROGRESS'
      },
      include: {
        timeEntries: {
          orderBy: {
            clockInTime: 'desc'
          }
        }
      },
      orderBy: {
        startTime: 'desc'
      }
    });
    
    if (!activeShift) {
      return res.status(404).json({
        success: false,
        message: 'No active shift found'
      });
    }
    
    // Check if currently clocked in
    const isClockedIn = activeShift.timeEntries.some(entry => !entry.clockOutTime);
    
    // Calculate shift duration so far
    const shiftDuration = Math.round((new Date() - new Date(activeShift.startTime)) / (1000 * 60));
    
    // Calculate worked time (excluding breaks)
    let workedMinutes = 0;
    let currentActivity = null;
    
    activeShift.timeEntries.forEach(entry => {
      const clockOutTime = entry.clockOutTime || new Date();
      const entryDuration = Math.round((clockOutTime - new Date(entry.clockInTime)) / (1000 * 60));
      
      if (entry.type === 'REGULAR') {
        workedMinutes += entryDuration;
      }
      
      // Set current activity if this is the active time entry
      if (!entry.clockOutTime) {
        currentActivity = entry.type;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        ...activeShift,
        isClockedIn,
        currentActivity,
        shiftDuration,
        formattedShiftDuration: formatMinutesToHoursAndMinutes(shiftDuration),
        workedMinutes,
        formattedWorkedTime: formatMinutesToHoursAndMinutes(workedMinutes),
        currentTime: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to format minutes to hours and minutes
function formatMinutesToHoursAndMinutes(minutes) {
  if (!minutes && minutes !== 0) return null;
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours === 0) {
    return `${remainingMinutes}m`;
  } else if (remainingMinutes === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${remainingMinutes}m`;
  }
}