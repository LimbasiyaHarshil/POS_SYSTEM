const { validationResult } = require('express-validator');
const prisma = require('../utils/prisma');

/**
 * @desc    Get all reservations
 * @route   GET /api/reservations
 * @access  Private
 */
exports.getReservations = async (req, res, next) => {
  try {
    const { 
      restaurantId, 
      date,
      customerId, 
      status,
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

    // Filter by date
    if (date) {
      const targetDate = new Date(date);
      const nextDay = new Date(targetDate);
      nextDay.setDate(targetDate.getDate() + 1);
      
      where.reservationTime = {
        gte: targetDate,
        lt: nextDay
      };
    }

    // Filter by customer
    if (customerId) {
      where.customerId = customerId;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }
    
    // Get reservations count for pagination
    const totalReservations = await prisma.reservation.count({
      where
    });

    // Get reservations with pagination
    const reservations = await prisma.reservation.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true
          }
        },
        tables: {
          select: {
            id: true,
            number: true
          }
        },
        restaurant: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        reservationTime: 'asc'
      },
      skip,
      take: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      count: reservations.length,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalReservations,
        pages: Math.ceil(totalReservations / parseInt(limit))
      },
      data: reservations
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single reservation
 * @route   GET /api/reservations/:id
 * @access  Private
 */
exports.getReservation = async (req, res, next) => {
  try {
    const { id } = req.params;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        customer: true,
        tables: {
          select: {
            id: true,
            number: true,
            capacity: true
          }
        },
        restaurant: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      reservation.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this reservation'
      });
    }

    res.status(200).json({
      success: true,
      data: reservation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a reservation
 * @route   POST /api/reservations
 * @access  Private
 */
exports.createReservation = async (req, res, next) => {
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
      customerId, 
      reservationTime, 
      partySize, 
      specialRequests, 
      tableIds,
      status = 'CONFIRMED'
    } = req.body;
    
    let { restaurantId } = req.body;

    // If not admin, can only create for own restaurant
    if (req.user.role !== 'ADMIN') {
      restaurantId = req.user.restaurantId;
    }

    // Check restaurant exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId }
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // If table IDs are provided, check if they exist and are available
    if (tableIds && tableIds.length > 0) {
      // Check if tables exist in the restaurant
      const tableCount = await prisma.table.count({
        where: {
          id: { in: tableIds },
          restaurantId
        }
      });

      if (tableCount !== tableIds.length) {
        return res.status(404).json({
          success: false,
          message: 'One or more tables not found in the restaurant'
        });
      }

      // Check if tables are reserved at the requested time
      const reservationDate = new Date(reservationTime);
      const startTime = new Date(reservationDate);
      startTime.setHours(startTime.getHours() - 1); // 1 hour before
      
      const endTime = new Date(reservationDate);
      endTime.setHours(endTime.getHours() + 3); // 3 hours after
      
      const conflictingReservations = await prisma.reservation.findMany({
        where: {
          tables: {
            some: {
              id: { in: tableIds }
            }
          },
          reservationTime: {
            gte: startTime,
            lte: endTime
          },
          status: {
            in: ['CONFIRMED', 'SEATED']
          }
        }
      });

      if (conflictingReservations.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'One or more tables are already reserved during this time'
        });
      }
    }

    // Create reservation
    const reservation = await prisma.reservation.create({
      data: {
        customer: {
          connect: { id: customerId }
        },
        restaurant: {
          connect: { id: restaurantId }
        },
        reservationTime: new Date(reservationTime),
        partySize,
        specialRequests,
        status,
        tables: tableIds?.length > 0 ? {
          connect: tableIds.map(id => ({ id }))
        } : undefined
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true
          }
        },
        tables: {
          select: {
            id: true,
            number: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: reservation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a reservation
 * @route   PUT /api/reservations/:id
 * @access  Private
 */
exports.updateReservation = async (req, res, next) => {
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
    const { 
      reservationTime, 
      partySize, 
      specialRequests, 
      status, 
      tableIds 
    } = req.body;

    // Check if reservation exists
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        tables: true
      }
    });

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      reservation.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this reservation'
      });
    }

    // Check if tables are being updated and if they're available
    if (tableIds && tableIds.length > 0) {
      // Check if tables exist in the restaurant
      const tableCount = await prisma.table.count({
        where: {
          id: { in: tableIds },
          restaurantId: reservation.restaurantId
        }
      });

      if (tableCount !== tableIds.length) {
        return res.status(404).json({
          success: false,
          message: 'One or more tables not found in the restaurant'
        });
      }

      // Check if tables are reserved at the requested time (if time is being changed)
      if (reservationTime) {
        const reservationDate = new Date(reservationTime);
        const startTime = new Date(reservationDate);
        startTime.setHours(startTime.getHours() - 1); // 1 hour before
        
        const endTime = new Date(reservationDate);
        endTime.setHours(endTime.getHours() + 3); // 3 hours after
        
        const conflictingReservations = await prisma.reservation.findMany({
          where: {
            id: { not: id }, // Exclude current reservation
            tables: {
              some: {
                id: { in: tableIds }
              }
            },
            reservationTime: {
              gte: startTime,
              lte: endTime
            },
            status: {
              in: ['CONFIRMED', 'SEATED']
            }
          }
        });

        if (conflictingReservations.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'One or more tables are already reserved during this time'
          });
        }
      }
    }

    // Build update data
    const updateData = {};
    if (reservationTime) updateData.reservationTime = new Date(reservationTime);
    if (partySize) updateData.partySize = partySize;
    if (specialRequests !== undefined) updateData.specialRequests = specialRequests;
    if (status) updateData.status = status;

    // Handle table connections/disconnections
    if (tableIds) {
      // First, disconnect all existing tables
      updateData.tables = {
        disconnect: reservation.tables.map(table => ({ id: table.id }))
      };
      
      // Then connect new tables if any
      if (tableIds.length > 0) {
        updateData.tables = {
          ...updateData.tables,
          connect: tableIds.map(id => ({ id }))
        };
      }
    }

    // Update reservation
    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true
          }
        },
        tables: {
          select: {
            id: true,
            number: true
          }
        }
      }
    });

    // If status changed to SEATED, update table status
    if (status === 'SEATED' && reservation.status !== 'SEATED') {
      // Get connected table IDs
      const currentTableIds = updatedReservation.tables.map(table => table.id);
      
      if (currentTableIds.length > 0) {
        await prisma.table.updateMany({
          where: { id: { in: currentTableIds } },
          data: { status: 'OCCUPIED' }
        });
      }
    }
    
    // If status changed to COMPLETED or CANCELLED, update table status if needed
    if ((status === 'COMPLETED' || status === 'CANCELLED') && 
        (reservation.status === 'CONFIRMED' || reservation.status === 'SEATED')) {
      // Get connected table IDs
      const currentTableIds = updatedReservation.tables.map(table => table.id);
      
      if (currentTableIds.length > 0) {
        // Check if tables are used in any active orders
        for (const tableId of currentTableIds) {
          const activeOrders = await prisma.order.count({
            where: {
              tableId,
              status: {
                in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
              }
            }
          });
          
          // Only update to available if no active orders
          if (activeOrders === 0) {
            await prisma.table.update({
              where: { id: tableId },
              data: { status: 'AVAILABLE' }
            });
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      data: updatedReservation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a reservation
 * @route   DELETE /api/reservations/:id
 * @access  Private/Manager/Admin
 */
exports.deleteReservation = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if reservation exists
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        tables: true
      }
    });

    if (!reservation) {
      return res.status(404).json({
        success: false,
        message: 'Reservation not found'
      });
    }

    // Check if user has access to this restaurant's data
    if (
      req.user.role !== 'ADMIN' &&
      reservation.restaurantId !== req.user.restaurantId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this reservation'
      });
    }

    // Delete reservation
    await prisma.reservation.delete({
      where: { id }
    });

    // If reservation was SEATED, check if tables need to be updated
    if (reservation.status === 'SEATED') {
      // Get table IDs
      const tableIds = reservation.tables.map(table => table.id);
      
      if (tableIds.length > 0) {
        // Check if tables are used in any active orders
        for (const tableId of tableIds) {
          const activeOrders = await prisma.order.count({
            where: {
              tableId,
              status: {
                in: ['PENDING', 'PREPARING', 'READY', 'SERVED']
              }
            }
          });
          
          // Only update to available if no active orders
          if (activeOrders === 0) {
            await prisma.table.update({
              where: { id: tableId },
              data: { status: 'AVAILABLE' }
            });
          }
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Reservation deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Check table availability
 * @route   GET /api/reservations/check-availability
 * @access  Private
 */
exports.checkAvailability = async (req, res, next) => {
  try {
    const { 
      date, 
      time, 
      partySize, 
      restaurantId = req.user.restaurantId
    } = req.query;
    
    if (!date || !time || !partySize || !restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'Date, time, party size, and restaurant ID are all required'
      });
    }
    
    // Combine date and time into a single date object
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    
    const reservationTime = new Date(year, month - 1, day, hour, minute);
    
    // Calculate time window (1 hour before and 3 hours after)
    const startTime = new Date(reservationTime);
    startTime.setHours(startTime.getHours() - 1);
    
    const endTime = new Date(reservationTime);
    endTime.setHours(endTime.getHours() + 3);
    
    // Get all restaurant tables
    const allTables = await prisma.table.findMany({
      where: {
        restaurantId,
        status: {
          not: 'MAINTENANCE'
        }
      },
      orderBy: {
        capacity: 'desc'
      }
    });
    
    // Get all tables in reservations during the time window
    const reservedTableIds = await prisma.reservation.findMany({
      where: {
        restaurantId,
        reservationTime: {
          gte: startTime,
          lte: endTime
        },
        status: {
          in: ['CONFIRMED', 'SEATED']
        }
      },
      select: {
        tables: {
          select: {
            id: true
          }
        }
      }
    }).then(reservations => 
      reservations.flatMap(reservation => 
        reservation.tables.map(table => table.id)
      )
    );
    
    // Filter out tables that are already reserved
    const availableTables = allTables.filter(
      table => !reservedTableIds.includes(table.id)
    );
    
    // Find table combinations for the party size
    const partySizeNum = parseInt(partySize);
    const tableCombinations = findTableCombinations(availableTables, partySizeNum);
    
    // Get available time slots (if this time doesn't work)
    let alternativeTimeSlots = [];
    
    if (tableCombinations.length === 0) {
      alternativeTimeSlots = await findAlternativeTimeSlots(
        reservationTime,
        partySizeNum,
        restaurantId
      );
    }
    
    res.status(200).json({
      success: true,
      data: {
        isAvailable: tableCombinations.length > 0,
        availableTables: tableCombinations.map(combination => ({
          tables: combination,
          totalCapacity: combination.reduce((sum, table) => sum + table.capacity, 0)
        })),
        alternativeTimeSlots
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to find table combinations that can accommodate party size
function findTableCombinations(tables, partySize, currentCombination = [], startIdx = 0, result = []) {
  // Calculate current capacity
  const currentCapacity = currentCombination.reduce((sum, table) => sum + table.capacity, 0);
  
  // If current combination is valid, add it to results
  if (currentCapacity >= partySize && currentCombination.length > 0) {
    result.push([...currentCombination]);
    if (result.length >= 5) return result; // Limit results to 5 combinations
  }
  
  // Try adding more tables
  for (let i = startIdx; i < tables.length; i++) {
    // Add this table
    currentCombination.push(tables[i]);
    
    // Recursively find more combinations
    findTableCombinations(tables, partySize, currentCombination, i + 1, result);
    
    // Remove this table (backtrack)
    currentCombination.pop();
  }
  
  return result;
}

// Helper function to find alternative time slots
async function findAlternativeTimeSlots(requestedTime, partySize, restaurantId) {
  const alternativeSlots = [];
  const baseTime = new Date(requestedTime);
  
  // Try 6 time slots: 30 min before, 30 min after, 60 min before, 60 min after, etc.
  const timeOffsets = [-30, 30, -60, 60, -90, 90]; // minutes
  
  for (const offset of timeOffsets) {
    const alternativeTime = new Date(baseTime);
    alternativeTime.setMinutes(alternativeTime.getMinutes() + offset);
    
    // Skip times outside of business hours (assumed 11am-10pm)
    const hour = alternativeTime.getHours();
    if (hour < 11 || hour >= 22) continue;
    
    // Calculate time window for this alternative
    const startTime = new Date(alternativeTime);
    startTime.setHours(startTime.getHours() - 1);
    
    const endTime = new Date(alternativeTime);
    endTime.setHours(endTime.getHours() + 3);
    
    // Get all restaurant tables
    const allTables = await prisma.table.findMany({
      where: {
        restaurantId,
        status: {
          not: 'MAINTENANCE'
        }
      }
    });
    
    // Get all tables in reservations during this time window
    const reservedTableIds = await prisma.reservation.findMany({
      where: {
        restaurantId,
        reservationTime: {
          gte: startTime,
          lte: endTime
        },
        status: {
          in: ['CONFIRMED', 'SEATED']
        }
      },
      select: {
        tables: {
          select: {
            id: true
          }
        }
      }
    }).then(reservations => 
      reservations.flatMap(reservation => 
        reservation.tables.map(table => table.id)
      )
    );
    
    // Filter out tables that are already reserved
    const availableTables = allTables.filter(
      table => !reservedTableIds.includes(table.id)
    );
    
    // Check if we have enough capacity
    const totalCapacity = availableTables.reduce((sum, table) => sum + table.capacity, 0);
    
    if (totalCapacity >= partySize) {
      alternativeSlots.push({
        time: alternativeTime.toISOString(),
        formattedTime: alternativeTime.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      });
    }
  }
  
  return alternativeSlots;
}