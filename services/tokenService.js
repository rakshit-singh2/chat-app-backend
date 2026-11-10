"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { loadAuthConfig } = require("../config/auth");

const config = loadAuthConfig();

class AuthTokenError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AuthTokenError";
    this.code = code;
    this.statusCode = 401;
    this.isOperational = true;
  }
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const generateRefreshToken = () => crypto.randomBytes(48).toString("base64url");

function signAccessToken(userId, tokenVersion = 0) {
  return jwt.sign({ type: "access", ver: tokenVersion }, config.accessSecret, {
    subject: String(userId),
    expiresIn: config.accessTtlSeconds,
    issuer: config.issuer,
    audience: config.audience,
    algorithm: "HS256",
  });
}

// Returns { userId, iat, tokenVersion } or throws AuthTokenError with code
// TOKEN_MISSING | TOKEN_EXPIRED | TOKEN_INVALID.
function verifyAccessToken(token) {
  if (!token) throw new AuthTokenError("You are not logged in.", "TOKEN_MISSING");
  try {
    const payload = jwt.verify(token, config.accessSecret, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["HS256"],
    });
    if (payload.type !== "access" || !payload.sub) throw new Error("wrong token type");
    return { userId: payload.sub, iat: payload.iat, tokenVersion: payload.ver ?? 0 };
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new AuthTokenError("Access token expired.", "TOKEN_EXPIRED");
    }
    throw new AuthTokenError("Invalid access token.", "TOKEN_INVALID");
  }
}

// getTokenVersion(userId) -> current User.tokenVersion, embedded in access tokens.
function createSessionService(Session, getTokenVersion = async () => 0) {
  async function issueSession(userId, { client = "web", userAgent, ip, family } = {}) {
    const refreshToken = generateRefreshToken();
    await Session.create({
      user: userId,
      tokenHash: hashToken(refreshToken),
      family: family || crypto.randomUUID(),
      client,
      userAgent: userAgent?.slice(0, 512),
      ip: ip?.slice(0, 64),
      expiresAt: new Date(Date.now() + config.refreshTtlSeconds * 1000),
    });
    await pruneSessions(userId);
    return {
      accessToken: signAccessToken(userId, await getTokenVersion(userId)),
      refreshToken,
      accessTokenExpiresIn: config.accessTtlSeconds,
      refreshTokenExpiresIn: config.refreshTtlSeconds,
    };
  }

  // Keep only the newest active sessions per user.
  async function pruneSessions(userId) {
    const active = await Session.find({ user: userId, revokedAt: null })
      .sort({ createdAt: -1 })
      .select("_id")
      .skip(config.maxSessionsPerUser);
    if (active.length) {
      await Session.updateMany(
        { _id: { $in: active.map((s) => s._id) } },
        { revokedAt: new Date() }
      );
    }
  }

  // Exchanges a refresh token for a new pair. The old token becomes invalid.
  async function rotateSession(refreshToken, meta = {}) {
    if (!refreshToken || typeof refreshToken !== "string") {
      throw new AuthTokenError("Refresh token missing.", "REFRESH_MISSING");
    }
    const session = await Session.findOne({ tokenHash: hashToken(refreshToken) });
    if (!session) throw new AuthTokenError("Invalid refresh token.", "REFRESH_INVALID");

    if (session.revokedAt) {
      // A token that was already rotated is being replayed: assume theft and
      // sign out every device in this login family.
      if (session.replacedBy) {
        await Session.updateMany(
          { family: session.family, revokedAt: null },
          { revokedAt: new Date() }
        );
      }
      throw new AuthTokenError("Session has been revoked. Please log in again.", "REFRESH_REVOKED");
    }
    if (session.expiresAt <= new Date()) {
      throw new AuthTokenError("Session expired. Please log in again.", "REFRESH_EXPIRED");
    }

    const next = await issueSession(session.user, {
      client: session.client,
      userAgent: meta.userAgent || session.userAgent,
      ip: meta.ip || session.ip,
      family: session.family,
    });
    // Conditional update so two concurrent refreshes cannot both succeed.
    const claimed = await Session.findOneAndUpdate(
      { _id: session._id, revokedAt: null },
      { revokedAt: new Date(), replacedBy: hashToken(next.refreshToken), lastUsedAt: new Date() }
    );
    if (!claimed) {
      await Session.updateOne({ tokenHash: hashToken(next.refreshToken) }, { revokedAt: new Date() });
      throw new AuthTokenError("Session has been revoked. Please log in again.", "REFRESH_REVOKED");
    }
    return { ...next, userId: String(session.user) };
  }

  async function revokeSession(refreshToken) {
    if (!refreshToken) return;
    await Session.updateOne(
      { tokenHash: hashToken(refreshToken), revokedAt: null },
      { revokedAt: new Date() }
    );
  }

  async function revokeAllSessions(userId) {
    await Session.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
  }

  return { issueSession, rotateSession, revokeSession, revokeAllSessions };
}

module.exports = {
  AuthTokenError,
  config,
  createSessionService,
  generateRefreshToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
};
