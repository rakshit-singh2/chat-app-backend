"use strict";

const { config } = require("../services/tokenService");

// Native apps (React Native) send `X-Client-Type: mobile` and receive the
// refresh token in the JSON body, to keep in secure device storage. Browsers
// receive it only as an httpOnly cookie that JavaScript cannot read.
function getClientType(req) {
  const header = String(req.get("x-client-type") || "").toLowerCase();
  return header === "mobile" ? "mobile" : "web";
}

function getRequestMeta(req) {
  return { client: getClientType(req), userAgent: req.get("user-agent"), ip: req.ip };
}

function cookieOptions(maxAgeSeconds) {
  const { path, domain, sameSite, secure } = config.refreshCookie;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path,
    ...(domain ? { domain } : {}),
    ...(maxAgeSeconds ? { maxAge: maxAgeSeconds * 1000 } : {}),
  };
}

function setRefreshCookie(res, refreshToken, maxAgeSeconds) {
  res.cookie(config.refreshCookie.name, refreshToken, cookieOptions(maxAgeSeconds));
}

function clearRefreshCookie(res) {
  res.clearCookie(config.refreshCookie.name, cookieOptions());
}

// Mobile clients send the token in the body; browsers send the cookie.
function readRefreshToken(req) {
  if (getClientType(req) === "mobile") return req.body?.refreshToken;
  return req.cookies?.[config.refreshCookie.name];
}

function sendTokens(req, res, { tokens, userId, message, statusCode = 200 }) {
  const mobile = getClientType(req) === "mobile";
  if (!mobile) setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresIn);
  res.status(statusCode).json({
    status: "success",
    message,
    user_id: String(userId),
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    ...(mobile
      ? { refreshToken: tokens.refreshToken, refreshTokenExpiresIn: tokens.refreshTokenExpiresIn }
      : {}),
  });
}

module.exports = {
  clearRefreshCookie,
  getClientType,
  getRequestMeta,
  readRefreshToken,
  sendTokens,
  setRefreshCookie,
};
