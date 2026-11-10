"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const mailService = require("../services/mailer");
const User = require("../models/user");
const Session = require("../models/session");
const PushSubscription = require("../models/pushSubscription");
const otpTemplate = require("../Templates/Mail/otp");
const resetPasswordTemplate = require("../Templates/Mail/resetPassword");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { validatePassword } = require("../utils/passwordPolicy");
const {
  AuthTokenError,
  createSessionService,
  verifyAccessToken,
} = require("../services/tokenService");
const {
  clearRefreshCookie,
  getClientType,
  getRequestMeta,
  readRefreshToken,
  sendTokens,
} = require("../utils/authResponse");

const sessions = createSessionService(Session, async (userId) => {
  const user = await User.findById(userId).select("tokenVersion");
  return user?.tokenVersion ?? 0;
});

// Revoke every refresh token and invalidate every access token of a user.
async function signOutEverywhere(req, userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await sessions.revokeAllSessions(userId);
  // Signed-out devices must stop receiving message previews.
  await PushSubscription.deleteMany({ user: userId });
  disconnectUserSockets(req, userId);
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// Used so a login for an unknown email takes as long as a real bcrypt check.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-password", 12);

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const normaliseEmail = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "");
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function requireFields(body, fields) {
  const missing = fields.filter((field) => !isNonEmptyString(body?.[field]));
  if (missing.length) {
    throw new AppError(`Missing required fields: ${missing.join(", ")}.`, 400, "VALIDATION_ERROR");
  }
}

function assertValidPassword(password) {
  const problem = validatePassword(password);
  if (problem) throw new AppError(problem, 400, "WEAK_PASSWORD");
}

// Disconnect every live socket of a user (after logout-all or a password change).
function disconnectUserSockets(req, userId) {
  req.app.get("io")?.in(String(userId)).disconnectSockets(true);
}

async function sendOtpEmail(user) {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  user.otp = code; // hashed by the User pre-save hook
  user.otp_expiry_time = new Date(Date.now() + OTP_TTL_MS);
  user.otp_attempts = 0;
  user.otp_last_sent_at = new Date();
  await user.save({ validateModifiedOnly: true });

  await mailService.sendEmail({
    to: user.email,
    subject: "Verification OTP",
    html: otpTemplate(user.firstName, code),
    attachments: [],
  });
}

const otpCooldownActive = (user) =>
  user.otp_last_sent_at && Date.now() - user.otp_last_sent_at.getTime() < OTP_RESEND_COOLDOWN_MS;

// ----------------------------------------------------------------------
// Registration and email verification

exports.register = catchAsync(async (req, res) => {
  requireFields(req.body, ["firstName", "lastName", "email", "password"]);
  const { firstName, lastName, password } = req.body;
  const email = normaliseEmail(req.body.email);
  assertValidPassword(password);

  let user = await User.findOne({ email });
  if (user?.verified) {
    throw new AppError("Email already in use. Please log in.", 409, "EMAIL_IN_USE");
  }

  if (user) {
    // Unverified account: let the owner of the inbox start over.
    user.firstName = firstName.trim();
    user.lastName = lastName.trim();
    user.password = password; // hashed by the pre-save hook
  } else {
    user = new User({ firstName: firstName.trim(), lastName: lastName.trim(), email, password });
  }
  await user.save();

  if (!otpCooldownActive(user)) await sendOtpEmail(user);

  res.status(201).json({
    status: "success",
    message: "Account created. We sent a verification code to your email.",
    email,
  });
});

// Resend a verification code. The response never reveals whether the email exists.
exports.sendOTP = catchAsync(async (req, res) => {
  requireFields(req.body, ["email"]);
  const user = await User.findOne({ email: normaliseEmail(req.body.email) });
  if (user && !user.verified && !otpCooldownActive(user)) await sendOtpEmail(user);

  res.status(200).json({
    status: "success",
    message: "If an unverified account exists for this email, a new code has been sent.",
  });
});

exports.verifyOTP = catchAsync(async (req, res) => {
  requireFields(req.body, ["email", "otp"]);
  const user = await User.findOne({ email: normaliseEmail(req.body.email) }).select("+otp");
  const invalid = new AppError("The code is invalid or has expired.", 400, "OTP_INVALID");

  if (!user || user.verified || !user.otp || !user.otp_expiry_time) throw invalid;
  if (user.otp_expiry_time.getTime() <= Date.now()) {
    throw new AppError("The code has expired. Please request a new one.", 400, "OTP_EXPIRED");
  }
  if (user.otp_attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError("Too many incorrect attempts. Please request a new code.", 429, "OTP_LOCKED");
  }

  if (!(await user.correctOTP(String(req.body.otp), user.otp))) {
    await User.updateOne({ _id: user._id }, { $inc: { otp_attempts: 1 } });
    throw invalid;
  }

  user.verified = true;
  user.otp = undefined;
  user.otp_expiry_time = undefined;
  user.otp_attempts = 0;
  await user.save({ validateModifiedOnly: true });

  const tokens = await sessions.issueSession(user._id, getRequestMeta(req));
  sendTokens(req, res, { tokens, userId: user._id, message: "Email verified successfully!" });
});

// ----------------------------------------------------------------------
// Login, token refresh and logout

exports.login = catchAsync(async (req, res) => {
  requireFields(req.body, ["email", "password"]);
  const email = normaliseEmail(req.body.email);
  const user = await User.findOne({ email }).select("+password");

  const passwordOk = await bcrypt.compare(String(req.body.password), user?.password || DUMMY_HASH);
  if (!user || !user.password || !passwordOk) {
    throw new AppError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");
  }

  if (!user.verified) {
    if (!otpCooldownActive(user)) await sendOtpEmail(user);
    return res.status(403).json({
      status: "fail",
      code: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email. We sent you a verification code.",
      email,
    });
  }

  const tokens = await sessions.issueSession(user._id, getRequestMeta(req));
  sendTokens(req, res, { tokens, userId: user._id, message: "Logged in successfully!" });
});

exports.refresh = catchAsync(async (req, res) => {
  // Cookie-based refresh must come from an allowed browser origin (CSRF defence).
  const origin = req.get("origin");
  if (getClientType(req) === "web" && origin && !allowedOrigins.includes(origin)) {
    throw new AppError("Origin not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  }

  try {
    const tokens = await sessions.rotateSession(readRefreshToken(req), {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    const user = await User.findById(tokens.userId).select("_id verified");
    if (!user?.verified) {
      await sessions.revokeSession(tokens.refreshToken);
      throw new AuthTokenError("Account is not available.", "REFRESH_INVALID");
    }
    sendTokens(req, res, { tokens, userId: user._id, message: "Token refreshed." });
  } catch (error) {
    if (error instanceof AuthTokenError) clearRefreshCookie(res);
    throw error;
  }
});

// Works with an expired access token: the refresh token identifies the session.
exports.logout = catchAsync(async (req, res) => {
  await sessions.revokeSession(readRefreshToken(req));
  clearRefreshCookie(res);
  res.status(200).json({ status: "success", message: "Logged out." });
});

exports.logoutAll = catchAsync(async (req, res) => {
  await signOutEverywhere(req, req.user._id);
  clearRefreshCookie(res);
  res.status(200).json({ status: "success", message: "Logged out of all devices." });
});

// ----------------------------------------------------------------------
// Route protection

exports.protect = catchAsync(async (req, res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const { userId, tokenVersion } = verifyAccessToken(token);

  const user = await User.findById(userId);
  if (!user || !user.verified) {
    throw new AuthTokenError("The account for this token no longer exists.", "TOKEN_INVALID");
  }
  if ((user.tokenVersion ?? 0) !== tokenVersion) {
    throw new AuthTokenError("Session ended. Please log in again.", "TOKEN_INVALID");
  }

  req.user = user;
  next();
});

// ----------------------------------------------------------------------
// Password reset and change

function passwordResetUrl(req, token) {
  const mobileBase = process.env.MOBILE_PASSWORD_RESET_URL;
  const base =
    getClientType(req) === "mobile" && mobileBase
      ? mobileBase
      : process.env.PASSWORD_RESET_URL || `${allowedOrigins[0]}/auth/new-password`;
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

exports.forgotPassword = catchAsync(async (req, res) => {
  requireFields(req.body, ["email"]);
  const user = await User.findOne({ email: normaliseEmail(req.body.email), verified: true });

  if (user) {
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    try {
      await mailService.sendEmail({
        to: user.email,
        subject: "Reset Password",
        html: resetPasswordTemplate(user.firstName, passwordResetUrl(req, resetToken)),
        attachments: [],
      });
    } catch (error) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      throw new AppError("We could not send the email. Please try again later.", 502, "EMAIL_FAILED");
    }
  }

  // Same answer whether or not the account exists.
  res.status(200).json({
    status: "success",
    message: "If an account exists for this email, a password reset link has been sent.",
  });
});

exports.resetPassword = catchAsync(async (req, res) => {
  requireFields(req.body, ["token", "password"]);
  const { password, passwordConfirm } = req.body;
  if (passwordConfirm !== undefined && passwordConfirm !== password) {
    throw new AppError("Passwords do not match.", 400, "PASSWORD_MISMATCH");
  }
  assertValidPassword(password);

  const hashedToken = crypto.createHash("sha256").update(req.body.token).digest("hex");
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });
  if (!user) {
    throw new AppError("The reset link is invalid or has expired.", 400, "RESET_TOKEN_INVALID");
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  await signOutEverywhere(req, user._id);

  const tokens = await sessions.issueSession(user._id, getRequestMeta(req));
  sendTokens(req, res, { tokens, userId: user._id, message: "Password reset successfully." });
});

exports.changePassword = catchAsync(async (req, res) => {
  requireFields(req.body, ["currentPassword", "newPassword"]);
  const { currentPassword, newPassword } = req.body;
  assertValidPassword(newPassword);

  const user = await User.findById(req.user._id).select("+password");
  if (!(await user.correctPassword(currentPassword, user.password))) {
    throw new AppError("Current password is incorrect.", 401, "INVALID_CREDENTIALS");
  }
  if (currentPassword === newPassword) {
    throw new AppError("New password must be different.", 400, "PASSWORD_UNCHANGED");
  }

  user.password = newPassword;
  await user.save();

  // Sign out every device; this one gets a fresh session below.
  await signOutEverywhere(req, user._id);
  const tokens = await sessions.issueSession(user._id, getRequestMeta(req));
  sendTokens(req, res, { tokens, userId: user._id, message: "Password changed successfully." });
});

