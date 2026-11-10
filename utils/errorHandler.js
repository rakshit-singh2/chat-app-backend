"use strict";

// Global Express error handler: always respond with JSON the frontend can show.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let statusCode = err.statusCode || 500;
  let message =
    err.isOperational || (statusCode >= 400 && statusCode < 500)
      ? err.message
      : "Something went wrong. Please try again.";

  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors).map((e) => e.message).join(" ");
  } else if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}.`;
  } else if (err.code === 11000) {
    statusCode = 409;
    message = "A record with that value already exists.";
  } else if (err.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Request body is not valid JSON.";
  }

  if (statusCode >= 500) console.error(err);

  res.status(statusCode).json({
    status: statusCode >= 500 ? "error" : "fail",
    ...(err.isOperational && typeof err.code === "string" ? { code: err.code } : {}),
    message,
    ...(process.env.NODE_ENV === "development" && statusCode >= 500 ? { detail: err.message } : {}),
  });
}

module.exports = errorHandler;
