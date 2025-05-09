const prisma = require('../utils/prisma');

/**
 * @desc    Get sales report
 * @route   GET /api/reports/sales
 * @access  Private/Manager/Admin
 */
exports.getSalesReport = async (req, res, next) => {
  try {
    const { 
      restaurantId,
      startDate, 
      endDate, 
      groupBy = 'day' 
    } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Validate groupBy parameter
    if (!['day', 'week', 'month'].includes(groupBy)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupBy parameter. Must be day, week, or month.'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }

    // Check if user has access to restaurant data
    let restaurantFilter = {};
    if (restaurantId) {
      if (req.user.role !== 'ADMIN' && req.user.restaurantId !== restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access data for this restaurant'
        });
      }
      restaurantFilter = { restaurantId };
    } else if (req.user.role !== 'ADMIN') {
      restaurantFilter = { restaurantId: req.user.restaurantId };
    }
    
    // Get completed orders in date range
    const orders = await prisma.order.findMany({
      where: {
        ...restaurantFilter,
        status: 'COMPLETED',
        completedAt: {
          gte: start,
          lte: end
        }
      },
      include: {
        orderItems: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                categoryId: true
              }
            }
          }
        },
        payments: {
          where: {
            status: 'COMPLETED'
          }
        }
      }
    });

    // Create summary data
    let totalSales = 0;
    let totalOrders = orders.length;
    let averageOrderValue = 0;
    
    // Payment method breakdown
    const paymentMethods = {};
    
    // Time-based groupings
    const salesByTime = {};
    
    // Item and category sales
    const itemSales = {};
    const categorySales = {};
    
    // Process orders
    orders.forEach(order => {
      totalSales += order.total;
      
      // Process payment methods
      order.payments.forEach(payment => {
        if (!paymentMethods[payment.method]) {
          paymentMethods[payment.method] = 0;
        }
        paymentMethods[payment.method] += payment.amount;
      });
      
      // Process time-based groupings
      let timeKey;
      const date = order.completedAt;
      
      switch (groupBy) {
        case 'day':
          timeKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
          break;
        case 'week':
          // Get week number and year
          const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
          const daysSinceFirstDay = Math.floor((date - firstDayOfYear) / (24 * 60 * 60 * 1000));
          const weekNumber = Math.ceil((daysSinceFirstDay + firstDayOfYear.getDay() + 1) / 7);
          timeKey = `${date.getFullYear()}-W${weekNumber}`;
          break;
        case 'month':
          timeKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
          break;
      }
      
      if (!salesByTime[timeKey]) {
        salesByTime[timeKey] = {
          count: 0,
          total: 0
        };
      }
      
      salesByTime[timeKey].count += 1;
      salesByTime[timeKey].total += order.total;
      
      // Process item sales
      order.orderItems.forEach(item => {
        const itemName = item.menuItem?.name;
        const categoryId = item.menuItem?.categoryId;
        
        if (itemName) {
          if (!itemSales[itemName]) {
            itemSales[itemName] = {
              quantity: 0,
              revenue: 0
            };
          }
          
          itemSales[itemName].quantity += item.quantity;
          itemSales[itemName].revenue += item.price * item.quantity;
        }
        
        // Process category sales
        if (categoryId) {
          if (!categorySales[categoryId]) {
            categorySales[categoryId] = {
              quantity: 0,
              revenue: 0
            };
          }
          
          categorySales[categoryId].quantity += item.quantity;
          categorySales[categoryId].revenue += item.price * item.quantity;
        }
      });
    });
    
    // Calculate average order value
    if (totalOrders > 0) {
      averageOrderValue = totalSales / totalOrders;
    }
    
    // Get category names
    const categories = await prisma.category.findMany({
      where: {
        id: {
          in: Object.keys(categorySales)
        }
      },
      select: {
        id: true,
        name: true
      }
    });
    
    // Replace category IDs with names
    const categorySalesWithNames = {};
    categories.forEach(category => {
      if (categorySales[category.id]) {
        categorySalesWithNames[category.name] = categorySales[category.id];
      }
    });

    // Get order type distribution
    const orderTypeDistribution = {};
    orders.forEach(order => {
      if (!orderTypeDistribution[order.type]) {
        orderTypeDistribution[order.type] = {
          count: 0,
          total: 0
        };
      }
      orderTypeDistribution[order.type].count += 1;
      orderTypeDistribution[order.type].total += order.total;
    });

    // Calculate hourly distribution
    const hourlyDistribution = Array(24).fill().map(() => ({ count: 0, total: 0 }));
    orders.forEach(order => {
      const hour = new Date(order.completedAt).getHours();
      hourlyDistribution[hour].count += 1;
      hourlyDistribution[hour].total += order.total;
    });

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          generatedAt: new Date().toISOString()
        },
        summary: {
          totalSales,
          totalOrders,
          averageOrderValue
        },
        paymentMethods,
        salesByTime: Object.entries(salesByTime).map(([timeKey, data]) => ({
          period: timeKey,
          orderCount: data.count,
          totalSales: data.total
        })),
        orderTypeDistribution: Object.entries(orderTypeDistribution).map(([type, data]) => ({
          type,
          orderCount: data.count,
          totalSales: data.total,
          percentageOfOrders: totalOrders > 0 ? (data.count / totalOrders * 100) : 0
        })),
        hourlyDistribution: hourlyDistribution.map((data, hour) => ({
          hour,
          orderCount: data.count,
          totalSales: data.total,
          formattedHour: `${hour.toString().padStart(2, '0')}:00`
        })),
        topItems: Object.entries(itemSales)
          .map(([name, data]) => ({
            name,
            quantity: data.quantity,
            revenue: data.revenue,
            averagePrice: data.quantity > 0 ? data.revenue / data.quantity : 0
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10),
        salesByCategory: Object.entries(categorySalesWithNames)
          .map(([name, data]) => ({
            category: name,
            quantity: data.quantity,
            revenue: data.revenue,
            percentageOfSales: totalSales > 0 ? (data.revenue / totalSales * 100) : 0
          }))
          .sort((a, b) => b.revenue - a.revenue)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get inventory usage report
 * @route   GET /api/reports/inventory-usage
 * @access  Private/Manager/Admin
 */
exports.getInventoryUsageReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }
    
    // Get all inventory items
    const inventoryItems = await prisma.inventoryItem.findMany();
    
    // Get all menu items and their inventory usage
    const menuItems = await prisma.menuItem.findMany({
      include: {
        inventoryUsages: {
          include: {
            inventoryItem: true
          }
        }
      }
    });
    
    // Get orders in date range
    const restaurantFilter = req.user.role !== 'ADMIN' && req.user.restaurantId 
      ? { restaurantId: req.user.restaurantId } 
      : {};
      
    const orders = await prisma.order.findMany({
      where: {
        ...restaurantFilter,
        status: {
          in: ['COMPLETED', 'SERVED']
        },
        createdAt: {
          gte: start,
          lte: end
        }
      },
      include: {
        orderItems: true
      }
    });
    
    // Calculate inventory usage
    const inventoryUsage = {};
    
    // Initialize with all inventory items
    inventoryItems.forEach(item => {
      inventoryUsage[item.id] = {
        id: item.id,
        name: item.name,
        unitType: item.unitType,
        totalUsage: 0,
        currentStock: item.quantity,
        reorderLevel: item.reorderLevel,
        cost: item.cost || 0,
        estimatedCost: 0,
        usageByItem: {}
      };
    });
    
    // Calculate usage based on orders
    orders.forEach(order => {
      order.orderItems.forEach(orderItem => {
        // Find menu item
        const menuItem = menuItems.find(item => item.id === orderItem.menuItemId);
        
        if (menuItem) {
          // Calculate inventory usage for this order item
          menuItem.inventoryUsages.forEach(usage => {
            const inventoryItemId = usage.inventoryItemId;
            const usagePerUnit = usage.quantity;
            const totalUsage = usagePerUnit * orderItem.quantity;
            
            if (inventoryUsage[inventoryItemId]) {
              inventoryUsage[inventoryItemId].totalUsage += totalUsage;
              
              // Track usage by menu item
              if (!inventoryUsage[inventoryItemId].usageByItem[menuItem.name]) {
                inventoryUsage[inventoryItemId].usageByItem[menuItem.name] = 0;
              }
              inventoryUsage[inventoryItemId].usageByItem[menuItem.name] += totalUsage;
              
              // Calculate estimated cost
              inventoryUsage[inventoryItemId].estimatedCost += 
                totalUsage * (inventoryUsage[inventoryItemId].cost || 0);
            }
          });
        }
      });
    });
    
    // Convert to array and add additional data
    const inventoryUsageArray = Object.values(inventoryUsage)
      .map(item => {
        const isLowStock = item.reorderLevel !== null && item.currentStock < item.reorderLevel;
        const usageByItemArray = Object.entries(item.usageByItem).map(([itemName, usage]) => ({
          itemName,
          usage,
          percentage: item.totalUsage > 0 ? (usage / item.totalUsage * 100) : 0
        })).sort((a, b) => b.usage - a.usage);
        
        return {
          ...item,
          usageByItem: usageByItemArray,
          lowStock: isLowStock,
          stockStatus: isLowStock ? 'Low' : 'OK',
          daysRemaining: item.totalUsage > 0 
            ? Math.floor(item.currentStock / (item.totalUsage / getDaysDifference(start, end)))
            : null
        };
      })
      .sort((a, b) => b.totalUsage - a.totalUsage);

    // Get total inventory value
    const totalInventoryValue = inventoryItems.reduce(
      (sum, item) => sum + (item.quantity * (item.cost || 0)), 
      0
    );

    // Get total estimated cost of used inventory
    const totalUsageCost = inventoryUsageArray.reduce(
      (sum, item) => sum + item.estimatedCost, 
      0
    );

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: getDaysDifference(start, end),
          generatedAt: new Date().toISOString()
        },
        summary: {
          totalInventoryValue,
          totalUsageCost,
          averageDailyCost: totalUsageCost / getDaysDifference(start, end)
        },
        inventoryUsage: inventoryUsageArray,
        lowStockItems: inventoryUsageArray.filter(item => item.lowStock)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get staff performance report
 * @route   GET /api/reports/staff-performance
 * @access  Private/Manager/Admin
 */
exports.getStaffPerformanceReport = async (req, res, next) => {
  try {
    const { restaurantId, startDate, endDate } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }
    
    // Check if user has access to restaurant data
    let restaurantFilter = {};
    if (restaurantId) {
      if (req.user.role !== 'ADMIN' && req.user.restaurantId !== restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access data for this restaurant'
        });
      }
      restaurantFilter = { restaurantId };
    } else if (req.user.role !== 'ADMIN') {
      restaurantFilter = { restaurantId: req.user.restaurantId };
    }
    
    // Get all orders in date range
    const orders = await prisma.order.findMany({
      where: {
        ...restaurantFilter,
        createdAt: {
          gte: start,
          lte: end
        }
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        orderItems: true
      }
    });
    
    // Get shifts in date range
    const shifts = await prisma.shift.findMany({
      where: {
        ...restaurantFilter,
        startTime: {
          gte: start,
          lte: end
        }
      },
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
    
    // Calculate staff performance
    const staffPerformance = {};
    
    // Process orders
    orders.forEach(order => {
      const userId = order.userId;
      const user = order.user;
      
      if (!staffPerformance[userId]) {
        staffPerformance[userId] = {
          userId,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          totalOrders: 0,
          totalOrderItems: 0,
          totalSales: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          hoursWorked: 0,
          shifts: 0
        };
      }
      
      staffPerformance[userId].totalOrders += 1;
      staffPerformance[userId].totalOrderItems += order.orderItems.length;
      staffPerformance[userId].totalSales += order.total;
      
      if (order.status === 'COMPLETED') {
        staffPerformance[userId].completedOrders += 1;
      } else if (order.status === 'CANCELLED') {
        staffPerformance[userId].cancelledOrders += 1;
      }
    });
    
    // Process shifts
    shifts.forEach(shift => {
      const userId = shift.userId;
      const user = shift.user;
      
      if (!staffPerformance[userId]) {
        staffPerformance[userId] = {
          userId,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          totalOrders: 0,
          totalOrderItems: 0,
          totalSales: 0,
          completedOrders: 0,
          cancelledOrders: 0,
          hoursWorked: 0,
          shifts: 0
        };
      }
      
      staffPerformance[userId].shifts += 1;
      
      // Calculate hours worked
      let shiftHours = 0;
      if (shift.endTime) {
        shiftHours = (new Date(shift.endTime) - new Date(shift.startTime)) / (1000 * 60 * 60);
      } else {
        // For shifts without end time, use current time as end
        shiftHours = (new Date() - new Date(shift.startTime)) / (1000 * 60 * 60);
      }
      
      // Don't count break time
      const breakMinutes = shift.timeEntries
        .filter(entry => entry.type === 'BREAK' && entry.clockOutTime)
        .reduce((total, entry) => {
          return total + (new Date(entry.clockOutTime) - new Date(entry.clockInTime)) / (1000 * 60);
        }, 0);
      
      shiftHours -= breakMinutes / 60;
      staffPerformance[userId].hoursWorked += Math.max(0, shiftHours);
    });
    
    // Convert to array and calculate derived metrics
    const staffPerformanceArray = Object.values(staffPerformance)
      .map(staff => {
        const salesPerHour = staff.hoursWorked > 0 ? staff.totalSales / staff.hoursWorked : 0;
        const ordersPerHour = staff.hoursWorked > 0 ? staff.totalOrders / staff.hoursWorked : 0;
        const itemsPerOrder = staff.totalOrders > 0 ? staff.totalOrderItems / staff.totalOrders : 0;
        
        return {
          ...staff,
          averageOrderValue: staff.totalOrders > 0 ? staff.totalSales / staff.totalOrders : 0,
          completionRate: staff.totalOrders > 0 ? staff.completedOrders / staff.totalOrders : 0,
          cancellationRate: staff.totalOrders > 0 ? staff.cancelledOrders / staff.totalOrders : 0,
          salesPerHour,
          ordersPerHour,
          itemsPerOrder
        };
      })
      .sort((a, b) => b.totalSales - a.totalSales);
    
    // Calculate restaurant totals
    const restaurantTotals = {
      totalSales: staffPerformanceArray.reduce((sum, staff) => sum + staff.totalSales, 0),
      totalOrders: staffPerformanceArray.reduce((sum, staff) => sum + staff.totalOrders, 0),
      totalShifts: staffPerformanceArray.reduce((sum, staff) => sum + staff.shifts, 0),
      totalHoursWorked: staffPerformanceArray.reduce((sum, staff) => sum + staff.hoursWorked, 0)
    };
    
    restaurantTotals.averageOrderValue = restaurantTotals.totalOrders > 0 
      ? restaurantTotals.totalSales / restaurantTotals.totalOrders 
      : 0;
      
    restaurantTotals.salesPerHour = restaurantTotals.totalHoursWorked > 0 
      ? restaurantTotals.totalSales / restaurantTotals.totalHoursWorked 
      : 0;

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: getDaysDifference(start, end),
          generatedAt: new Date("2025-05-09T09:32:06Z").toISOString() // Using the current timestamp provided
        },
        restaurantTotals,
        staffPerformance: staffPerformanceArray
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user login report
 * @route   GET /api/reports/user-logins
 * @access  Private/Manager/Admin
 */
exports.getUserLoginReport = async (req, res, next) => {
  try {
    const { 
      restaurantId,
      userId,
      startDate, 
      endDate
    } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }
    
    // Build filter condition
    const where = {
      loginTime: {
        gte: start,
        lte: end
      }
    };
    
    // Filter by restaurant if provided
    if (restaurantId) {
      if (req.user.role !== 'ADMIN' && req.user.restaurantId !== restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access data for this restaurant'
        });
      }
      where.restaurantId = restaurantId;
    } else if (req.user.role !== 'ADMIN') {
      where.restaurantId = req.user.restaurantId;
    }
    
    // Filter by user if provided
    if (userId) {
      where.userId = userId;
    }

    // Get sessions
    const sessions = await prisma.userSession.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        }
      },
      orderBy: {
        loginTime: 'desc'
      }
    });
    
    // Calculate session statistics
    const userStats = {};
    let totalSessions = sessions.length;
    let totalActiveSessions = 0;
    let totalDuration = 0;
    
    const currentTime = new Date("2025-05-09T09:32:06Z"); // Using the current timestamp provided
    
    sessions.forEach(session => {
      const userId = session.userId;
      const userName = `${session.user.firstName} ${session.user.lastName}`;
      const userRole = session.user.role;
      
      // Calculate session duration
      let sessionDuration = 0;
      if (session.logoutTime) {
        sessionDuration = (new Date(session.logoutTime) - new Date(session.loginTime)) / 1000 / 60; // minutes
      } else {
        sessionDuration = (currentTime - new Date(session.loginTime)) / 1000 / 60; // minutes
        totalActiveSessions++;
      }
      
      totalDuration += sessionDuration;
      
      // Add to user stats
      if (!userStats[userId]) {
        userStats[userId] = {
          userId,
          name: userName,
          role: userRole,
          sessionCount: 0,
          activeSessions: 0,
          totalDuration: 0,
          averageDuration: 0,
          firstLogin: null,
          lastLogin: null,
          devices: {}
        };
      }
      
      userStats[userId].sessionCount++;
      
      if (session.isActive) {
        userStats[userId].activeSessions++;
      }
      
      userStats[userId].totalDuration += sessionDuration;
      
      // Track login times
      const loginTime = new Date(session.loginTime);
      if (!userStats[userId].firstLogin || loginTime < new Date(userStats[userId].firstLogin)) {
        userStats[userId].firstLogin = loginTime;
      }
      if (!userStats[userId].lastLogin || loginTime > new Date(userStats[userId].lastLogin)) {
        userStats[userId].lastLogin = loginTime;
      }
      
      // Track devices
      if (session.userAgent) {
        const deviceType = getDeviceType(session.userAgent);
        if (!userStats[userId].devices[deviceType]) {
          userStats[userId].devices[deviceType] = 0;
        }
        userStats[userId].devices[deviceType]++;
      }
    });
    
    // Convert userStats to array and calculate averages
    const userStatsList = Object.values(userStats).map(stat => {
      stat.averageDuration = stat.sessionCount > 0 ? stat.totalDuration / stat.sessionCount : 0;
      stat.devicesArray = Object.entries(stat.devices).map(([device, count]) => ({
        device,
        count,
        percentage: stat.sessionCount > 0 ? (count / stat.sessionCount) * 100 : 0
      }));
      return stat;
    });
    
    // Sort by session count
    userStatsList.sort((a, b) => b.sessionCount - a.sessionCount);
    
    // Daily login patterns
    const dailyLogins = Array(7).fill().map(() => ({ count: 0 }));
    const hourlyLogins = Array(24).fill().map(() => ({ count: 0 }));
    
    sessions.forEach(session => {
      const date = new Date(session.loginTime);
      dailyLogins[date.getDay()].count++;
      hourlyLogins[date.getHours()].count++;
    });
    
    // Add day names
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach((day, index) => {
      dailyLogins[index].day = day;
      dailyLogins[index].percentage = totalSessions > 0 ? (dailyLogins[index].count / totalSessions) * 100 : 0;
    });
    
    // Add hour formats
    for (let i = 0; i < 24; i++) {
      hourlyLogins[i].hour = i;
      hourlyLogins[i].formattedHour = `${i.toString().padStart(2, '0')}:00`;
      hourlyLogins[i].percentage = totalSessions > 0 ? (hourlyLogins[i].count / totalSessions) * 100 : 0;
    }

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: getDaysDifference(start, end),
          generatedAt: currentTime.toISOString()
        },
        summary: {
          totalSessions,
          totalActiveSessions,
          averageSessionDuration: totalSessions > 0 ? totalDuration / totalSessions : 0,
          usersLogged: userStatsList.length
        },
        userStats: userStatsList,
        loginPatterns: {
          byDay: dailyLogins,
          byHour: hourlyLogins,
          mostPopularDay: dailyLogins.reduce((a, b) => a.count > b.count ? a : b, dailyLogins[0]).day,
          mostPopularHour: hourlyLogins.reduce((a, b) => a.count > b.count ? a : b, hourlyLogins[0]).formattedHour
        },
        sessions: sessions.map(session => ({
          id: session.id,
          user: `${session.user.firstName} ${session.user.lastName}`,
          role: session.user.role,
          loginTime: session.loginTime,
          logoutTime: session.logoutTime,
          isActive: session.isActive,
          ipAddress: session.ipAddress,
          userAgent: formatUserAgent(session.userAgent),
          deviceType: getDeviceType(session.userAgent),
          duration: session.logoutTime 
            ? (new Date(session.logoutTime) - new Date(session.loginTime)) / 1000 / 60 
            : (currentTime - new Date(session.loginTime)) / 1000 / 60,
          formattedDuration: session.logoutTime 
            ? formatMinutesToHoursAndMinutes((new Date(session.logoutTime) - new Date(session.loginTime)) / 1000 / 60)
            : formatMinutesToHoursAndMinutes((currentTime - new Date(session.loginTime)) / 1000 / 60)
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get table utilization report
 * @route   GET /api/reports/table-utilization
 * @access  Private/Manager/Admin
 */
exports.getTableUtilizationReport = async (req, res, next) => {
  try {
    const { restaurantId, startDate, endDate } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }
    
    // Check if user has access to restaurant data
    let targetRestaurantId = restaurantId;
    if (restaurantId) {
      if (req.user.role !== 'ADMIN' && req.user.restaurantId !== restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access data for this restaurant'
        });
      }
    } else if (req.user.role !== 'ADMIN') {
      targetRestaurantId = req.user.restaurantId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID is required'
      });
    }
    
    // Get all tables for the restaurant
    const tables = await prisma.table.findMany({
      where: {
        restaurantId: targetRestaurantId
      }
    });
    
    // Get all orders with table info in the date range
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: targetRestaurantId,
        createdAt: {
          gte: start,
          lte: end
        },
        tableId: { not: null }
      },
      include: {
        table: true
      }
    });
    
    // Get all reservations in the date range
    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId: targetRestaurantId,
        reservationTime: {
          gte: start,
          lte: end
        },
        status: {
          in: ['CONFIRMED', 'SEATED', 'COMPLETED']
        }
      },
      include: {
        tables: true
      }
    });
    
    // Calculate table utilization
    const tableStats = {};
    tables.forEach(table => {
      tableStats[table.id] = {
        tableId: table.id,
        tableNumber: table.number,
        capacity: table.capacity,
        orderCount: 0,
        totalRevenue: 0,
        totalOccupiedMinutes: 0,
        reservationCount: 0,
        averagePartySize: 0,
        totalPartySize: 0
      };
    });
    
    // Process orders
    orders.forEach(order => {
      if (order.tableId && tableStats[order.tableId]) {
        tableStats[order.tableId].orderCount++;
        tableStats[order.tableId].totalRevenue += order.total;
        
        // Estimate occupied time (if completed orders have completedAt timestamp)
        if (order.status === 'COMPLETED' && order.completedAt) {
          const occupiedMinutes = (new Date(order.completedAt) - new Date(order.createdAt)) / (1000 * 60);
          tableStats[order.tableId].totalOccupiedMinutes += occupiedMinutes;
        } else {
          // Default to 60 minutes if no completedAt
          tableStats[order.tableId].totalOccupiedMinutes += 60;
        }
      }
    });
    
    // Process reservations
    reservations.forEach(reservation => {
      reservation.tables.forEach(table => {
        if (tableStats[table.id]) {
          tableStats[table.id].reservationCount++;
          tableStats[table.id].totalPartySize += reservation.partySize;
        }
      });
    });
    
    // Calculate additional metrics and convert to array
    const tableStatsArray = Object.values(tableStats).map(stats => {
      // Calculate average party size from reservations
      stats.averagePartySize = stats.reservationCount > 0 
        ? stats.totalPartySize / stats.reservationCount 
        : 0;
      
      // Calculate revenue per seat
      stats.revenuePerSeat = stats.capacity > 0 
        ? stats.totalRevenue / stats.capacity 
        : 0;
      
      // Calculate revenue per hour
      stats.revenuePerHour = stats.totalOccupiedMinutes > 0 
        ? (stats.totalRevenue / stats.totalOccupiedMinutes) * 60 
        : 0;
      
      // Calculate utilization percentage (based on operating hours)
      const totalPossibleMinutes = getDaysDifference(start, end) * 12 * 60; // Assume 12 operating hours/day
      stats.utilizationPercentage = totalPossibleMinutes > 0 
        ? (stats.totalOccupiedMinutes / totalPossibleMinutes) * 100 
        : 0;
      
      return stats;
    });
    
    // Sort by revenue
    tableStatsArray.sort((a, b) => b.totalRevenue - a.totalRevenue);
    
    // Calculate restaurant totals
    const restaurantTotals = {
      totalTables: tables.length,
      totalCapacity: tables.reduce((sum, table) => sum + table.capacity, 0),
      totalOrders: tableStatsArray.reduce((sum, stats) => sum + stats.orderCount, 0),
      totalRevenue: tableStatsArray.reduce((sum, stats) => sum + stats.totalRevenue, 0),
      totalReservations: tableStatsArray.reduce((sum, stats) => sum + stats.reservationCount, 0),
      averageUtilization: tableStatsArray.reduce((sum, stats) => sum + stats.utilizationPercentage, 0) / tableStatsArray.length,
      mostUtilizedTable: tableStatsArray.reduce((a, b) => a.utilizationPercentage > b.utilizationPercentage ? a : b, tableStatsArray[0])?.tableNumber,
      leastUtilizedTable: tableStatsArray.reduce((a, b) => a.utilizationPercentage < b.utilizationPercentage ? a : b, tableStatsArray[0])?.tableNumber
    };

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: getDaysDifference(start, end),
          generatedAt: new Date("2025-05-09T09:32:06Z").toISOString() // Using the current timestamp provided
        },
        restaurantTotals,
        tableStats: tableStatsArray
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get gift card and voucher report
 * @route   GET /api/reports/promotions
 * @access  Private/Manager/Admin
 */
exports.getPromotionsReport = async (req, res, next) => {
  try {
    const { restaurantId, startDate, endDate } = req.query;
    
    // Make sure we have date range
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    // Calculate date ranges
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Check date range validity
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date cannot be after end date'
      });
    }
    
    // Check if user has access to restaurant data
    let targetRestaurantId = restaurantId;
    if (restaurantId) {
      if (req.user.role !== 'ADMIN' && req.user.restaurantId !== restaurantId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access data for this restaurant'
        });
      }
    } else if (req.user.role !== 'ADMIN') {
      targetRestaurantId = req.user.restaurantId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID is required'
      });
    }

    // Get gift card transactions in date range
    const giftCardTransactions = await prisma.giftCardTransaction.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        },
        giftCard: {
          restaurantId: targetRestaurantId
        }
      },
      include: {
        giftCard: true,
        payment: {
          include: {
            order: true
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Get voucher redemptions in date range
    const voucherRedemptions = await prisma.voucherRedemption.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        },
        voucher: {
          restaurantId: targetRestaurantId
        }
      },
      include: {
        voucher: true,
        order: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Get all gift cards
    const giftCards = await prisma.giftCard.findMany({
      where: {
        restaurantId: targetRestaurantId
      }
    });
    
    // Get all vouchers
    const vouchers = await prisma.voucher.findMany({
      where: {
        restaurantId: targetRestaurantId
      }
    });
    
    // Process gift card data
    const giftCardStats = {
      totalIssued: giftCardTransactions.filter(t => t.type === 'ISSUE').length,
      totalIssueAmount: giftCardTransactions
        .filter(t => t.type === 'ISSUE')
        .reduce((sum, t) => sum + t.amount, 0),
      totalRedeemed: giftCardTransactions.filter(t => t.type === 'REDEEM').length,
      totalRedeemAmount: giftCardTransactions
        .filter(t => t.type === 'REDEEM')
        .reduce((sum, t) => sum + t.amount, 0),
      totalLoaded: giftCardTransactions.filter(t => t.type === 'LOAD').length,
      totalLoadAmount: giftCardTransactions
        .filter(t => t.type === 'LOAD')
        .reduce((sum, t) => sum + t.amount, 0),
      activeGiftCards: giftCards.filter(gc => gc.isActive).length,
      totalOutstandingBalance: giftCards
        .filter(gc => gc.isActive)
        .reduce((sum, gc) => sum + gc.currentBalance, 0)
    };
    
    // Process voucher data
    const voucherTypes = {};
    vouchers.forEach(voucher => {
      if (!voucherTypes[voucher.type]) {
        voucherTypes[voucher.type] = {
          type: voucher.type,
          count: 0,
          redemptionCount: 0,
          totalDiscountAmount: 0
        };
      }
      voucherTypes[voucher.type].count++;
    });
    
    // Calculate total discount amount (estimated)
    voucherRedemptions.forEach(redemption => {
      const voucherType = redemption.voucher.type;
      if (!voucherTypes[voucherType]) {
        voucherTypes[voucherType] = {
          type: voucherType,
          count: 0,
          redemptionCount: 0,
          totalDiscountAmount: 0
        };
      }
      
      voucherTypes[voucherType].redemptionCount++;
      
      // Estimate discount amount based on voucher type
      let discountAmount = 0;
      if (voucherType === 'FIXED_AMOUNT') {
        discountAmount = redemption.voucher.value;
      } else if (voucherType === 'PERCENTAGE') {
        // Estimate based on order subtotal if available
        if (redemption.order?.subtotal) {
          discountAmount = (redemption.order.subtotal * redemption.voucher.value) / 100;
        }
      } else if (voucherType === 'FREE_ITEM') {
        discountAmount = redemption.voucher.value;
      }
      
      voucherTypes[voucherType].totalDiscountAmount += discountAmount;
    });
    
    const voucherStats = {
      totalVouchers: vouchers.length,
      totalActive: vouchers.filter(v => v.isActive).length,
      totalRedemptions: voucherRedemptions.length,
      totalDiscountAmount: Object.values(voucherTypes).reduce((sum, vt) => sum + vt.totalDiscountAmount, 0),
      voucherTypes: Object.values(voucherTypes)
    };
    
    // Calculate top redeemed vouchers
    const topVouchers = vouchers
      .map(voucher => {
        const redemptions = voucherRedemptions.filter(r => r.voucherId === voucher.id).length;
        return {
          id: voucher.id,
          code: voucher.code,
          type: voucher.type,
          value: voucher.value,
          redemptionCount: redemptions,
          usageRate: voucher.usageLimit ? (voucher.usageCount / voucher.usageLimit) * 100 : null
        };
      })
      .sort((a, b) => b.redemptionCount - a.redemptionCount)
      .slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: getDaysDifference(start, end),
          generatedAt: new Date("2025-05-09T09:32:06Z").toISOString() // Using the current timestamp provided
        },
        giftCardStats,
        voucherStats,
        topVouchers,
        giftCardTransactions: giftCardTransactions.map(transaction => ({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          createdAt: transaction.createdAt,
          giftCardCode: transaction.giftCard.code,
          user: transaction.user ? `${transaction.user.firstName} ${transaction.user.lastName}` : 'System',
          notes: transaction.notes,
          orderId: transaction.payment?.order?.id,
          orderNumber: transaction.payment?.order?.orderNumber
        })),
        voucherRedemptions: voucherRedemptions.map(redemption => ({
          id: redemption.id,
          createdAt: redemption.createdAt,
          voucherCode: redemption.voucher.code,
          voucherType: redemption.voucher.type,
          voucherValue: redemption.voucher.value,
          orderId: redemption.order.id,
          orderNumber: redemption.order.orderNumber,
          orderTotal: redemption.order.total,
          user: `${redemption.user.firstName} ${redemption.user.lastName}`
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to get days difference between two dates
function getDaysDifference(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays); // Minimum 1 day
}

// Helper function to format minutes to hours and minutes
function formatMinutesToHoursAndMinutes(minutes) {
  if (!minutes && minutes !== 0) return '0m';
  
  minutes = Math.round(minutes);
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

// Helper function to get device type from user agent
function getDeviceType(userAgent) {
  if (!userAgent) return 'Unknown';
  
  userAgent = userAgent.toLowerCase();
  
  if (userAgent.includes('mobile')) return 'Mobile';
  if (userAgent.includes('tablet')) return 'Tablet';
  if (userAgent.includes('ipad')) return 'Tablet';
  if (userAgent.includes('android')) return 'Mobile';
  if (userAgent.includes('iphone')) return 'Mobile';
  if (userAgent.includes('windows phone')) return 'Mobile';
  
  return 'Desktop';
}

// Helper function to format user agent
function formatUserAgent(userAgent) {
  if (!userAgent) return 'Unknown';
  
  // Extract browser and OS information
  let browser = 'Unknown';
  let os = 'Unknown';
  
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';
  else if (userAgent.includes('MSIE') || userAgent.includes('Trident')) browser = 'Internet Explorer';
  
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'MacOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS')) os = 'iOS';
  
  return `${browser} on ${os}`;
}