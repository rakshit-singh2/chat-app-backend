"use strict";

// Central authentication settings, read once from the environment.
// Startup fails outside development when a setting is unsafe.

const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

function parseDuration(value, fallbackSeconds) {
  if (value == null || value === "") return fallbackSeconds;
  const match = String(value).trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!match) throw new Error(`Invalid duration "${value}". Use e.g. 900, 15m, 12h or 30d.`);
  return Number(match[1]) * DURATION_UNITS[(match[2] || "s").toLowerCase()];
}

function loadAuthConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isDevelopment = nodeEnv === "development";
  const isTest = nodeEnv === "test";

  // JWT_SECRET is accepted as a fallback for older .env files.
  const accessSecret = env.JWT_ACCESS_SECRET || env.JWT_SECRET || "";
  if (accessSecret.length < 32) {
    const message =
      "JWT_ACCESS_SECRET must be at least 32 characters. Generate one with: " +
      "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"";
    if (!isDevelopment && !isTest) throw new Error(message);
    if (!isTest) console.warn(`[auth] WARNING: ${message}`);
  }

  const sameSite = (env.REFRESH_COOKIE_SAMESITE || "strict").toLowerCase();
  if (!["strict", "lax", "none"].includes(sameSite)) {
    throw new Error("REFRESH_COOKIE_SAMESITE must be strict, lax or none.");
  }
  const secureCookie = env.REFRESH_COOKIE_SECURE
    ? env.REFRESH_COOKIE_SECURE === "true"
    : !isDevelopment && !isTest;
  if (sameSite === "none" && !secureCookie) {
    throw new Error("REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true.");
  }

  return {
    nodeEnv,
    accessSecret: accessSecret || "development-only-insecure-secret-change-me!!",
    accessTtlSeconds: parseDuration(env.ACCESS_TOKEN_TTL, 15 * 60),
    refreshTtlSeconds: parseDuration(env.REFRESH_TOKEN_TTL, 30 * 24 * 3600),
    issuer: env.JWT_ISSUER || "chat-app-api",
    audience: env.JWT_AUDIENCE || "chat-app-clients",
    refreshCookie: {
      name: env.REFRESH_COOKIE_NAME || "refresh_token",
      // Scoped to the auth routes so it is never sent with ordinary API calls.
      path: "/auth",
      domain: env.REFRESH_COOKIE_DOMAIN || undefined,
      sameSite,
      secure: secureCookie,
    },
    maxSessionsPerUser: Number(env.MAX_SESSIONS_PER_USER) || 10,
    bcryptRounds: Number(env.BCRYPT_ROUNDS) || 12,
  };
}

module.exports = { loadAuthConfig, parseDuration };
