"use strict";

// Express 5 makes `req.query` a read-only getter, so express-mongo-sanitize and
// xss-clean crash with "Cannot set property query". This middleware applies the
// same cleaning to body, params and query, and redefines `query` on the request.
const { sanitize: stripMongoOperators } = require("express-mongo-sanitize");
const { clean: stripXss } = require("xss-clean/lib/xss");

const cleanValue = (value) => stripXss(stripMongoOperators(value));

function sanitizeRequest() {
  return (req, res, next) => {
    if (req.body) req.body = cleanValue(req.body);
    if (req.params) req.params = cleanValue(req.params);
    if (req.query) {
      Object.defineProperty(req, "query", {
        value: cleanValue({ ...req.query }),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}

module.exports = sanitizeRequest;
