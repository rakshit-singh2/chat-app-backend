"use strict";

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const { getRedis, keyPrefix } = require("../services/redis");

// Shared counters across instances when Redis is configured; otherwise memory.
const storeFor = (name) => {
  const client = getRedis();
  return client
    ? new RedisStore({ prefix: `${keyPrefix}rl:${name}:`, sendCommand: (...args) => client.sendCommand(args) })
    : undefined;
};
// If Redis is briefly unavailable, let requests through rather than failing them.
const common = { standardHeaders: "draft-8", legacyHeaders: false, passOnStoreError: true };

const json = (message) => (req, res) =>
  res.status(429).json({ status: "fail", code: "RATE_LIMITED", message });

const emailKey = (req) =>
  `${ipKeyGenerator(req.ip)}|${String(req.body?.email || "").trim().toLowerCase()}`;

const minutes = (n) => n * 60 * 1000;

// Applied to every request.
const apiLimiter = rateLimit({
  ...common,
  store: storeFor("api"),
  windowMs: minutes(15),
  limit: 1000,
  handler: json("Too many requests. Please try again later."),
});

// Password guessing: per IP + email, successful logins are not counted.
const loginLimiter = rateLimit({
  ...common,
  store: storeFor("login"),
  windowMs: minutes(15),
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
  handler: json("Too many login attempts. Please wait 15 minutes and try again."),
});

// Registration, OTP and password-reset emails.
const emailLimiter = rateLimit({
  ...common,
  store: storeFor("email"),
  windowMs: minutes(15),
  limit: 5,
  keyGenerator: emailKey,
  handler: json("Too many requests for this email. Please wait 15 minutes and try again."),
});

// Code and reset-token guessing.
const verifyLimiter = rateLimit({
  ...common,
  store: storeFor("verify"),
  windowMs: minutes(15),
  limit: 20,
  handler: json("Too many attempts. Please wait 15 minutes and try again."),
});

const refreshLimiter = rateLimit({
  ...common,
  store: storeFor("refresh"),
  windowMs: minutes(15),
  limit: 300,
  handler: json("Too many refresh attempts. Please try again later."),
});

module.exports = { apiLimiter, emailLimiter, loginLimiter, refreshLimiter, verifyLimiter };
