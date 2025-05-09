/**
 * Global error handler middleware
 */
exports.errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  
  // Log error for dev
  console.error(err);
  
  // Prisma error handling
  if (err.code) {
    // Handle unique constraint violations
    if (err.code === 'P2002') {
      error.message = `A record with this ${err.meta.target.join(', ')} already exists`;
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    
    // Handle record not found
    if (err.code === 'P2001' || err.code === 'P2018') {
      error.message = `Resource not found`;
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }
  
  // Default error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error'
  });
};