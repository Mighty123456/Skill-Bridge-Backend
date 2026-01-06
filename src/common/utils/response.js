/**
 * Standard API response helper
 */
const sendResponse = (res, statusCode, success, message, data = null) => {
  const response = {
    success,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Success response
 */
const successResponse = (res, message, data = null, statusCode = 200) => {
  return sendResponse(res, statusCode, true, message, data);
};

/**
 * Error response
 */
const errorResponse = (res, message, statusCode = 400) => {
  return sendResponse(res, statusCode, false, message);
};

module.exports = {
  sendResponse,
  successResponse,
  errorResponse
};

