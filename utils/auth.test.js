"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-definitely-longer-than-32-chars";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAuthConfig, parseDuration } = require("../config/auth");
const { validatePassword } = require("./passwordPolicy");
const { sendTokens, readRefreshToken, getClientType } = require("./authResponse");

const strongSecret = "x".repeat(40);

test("parses durations", () => {
  assert.equal(parseDuration("900", 1), 900);
  assert.equal(parseDuration("15m", 1), 900);
  assert.equal(parseDuration("30d", 1), 2592000);
  assert.equal(parseDuration("", 42), 42);
  assert.throws(() => parseDuration("soon", 1));
});

test("refuses weak secrets and insecure cookies outside development", () => {
  assert.throws(() => loadAuthConfig({ NODE_ENV: "production", JWT_ACCESS_SECRET: "short" }));
  assert.throws(() =>
    loadAuthConfig({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: strongSecret,
      REFRESH_COOKIE_SAMESITE: "none",
      REFRESH_COOKIE_SECURE: "false",
    })
  );
  const prod = loadAuthConfig({ NODE_ENV: "production", JWT_ACCESS_SECRET: strongSecret });
  assert.equal(prod.refreshCookie.secure, true);
  assert.equal(prod.refreshCookie.sameSite, "strict");
  assert.equal(prod.accessTtlSeconds, 900);
});

test("accepts the legacy JWT_SECRET name", () => {
  const cfg = loadAuthConfig({ NODE_ENV: "production", JWT_SECRET: strongSecret });
  assert.equal(cfg.accessSecret, strongSecret);
});

test("password policy", () => {
  assert.match(validatePassword(""), /required/);
  assert.match(validatePassword("Ab1"), /at least 8/);
  assert.match(validatePassword("alllowercase1"), /uppercase/);
  assert.match(validatePassword("A1" + "é".repeat(40)), /72 bytes/);
  assert.equal(validatePassword("Str0ngPassword"), null);
});

function fakeReq(headers = {}, extra = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()], ...extra };
}
function fakeRes() {
  return {
    cookies: [],
    statusCode: 0,
    body: null,
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}
const tokens = {
  accessToken: "access",
  refreshToken: "refresh-secret",
  accessTokenExpiresIn: 900,
  refreshTokenExpiresIn: 2592000,
};

test("web clients get the refresh token only as an httpOnly cookie", () => {
  const res = fakeRes();
  sendTokens(fakeReq(), res, { tokens, userId: "u1", message: "ok" });
  assert.equal(res.body.accessToken, "access");
  assert.equal(res.body.refreshToken, undefined);
  assert.equal(res.cookies.length, 1);
  assert.equal(res.cookies[0].value, "refresh-secret");
  assert.equal(res.cookies[0].options.httpOnly, true);
  assert.equal(res.cookies[0].options.path, "/auth");
});

test("mobile clients get the refresh token in the body and no cookie", () => {
  const req = fakeReq({ "X-Client-Type": "mobile" });
  const res = fakeRes();
  assert.equal(getClientType(req), "mobile");
  sendTokens(req, res, { tokens, userId: "u1", message: "ok" });
  assert.equal(res.body.refreshToken, "refresh-secret");
  assert.equal(res.cookies.length, 0);
});

test("reads the refresh token from the right place per client", () => {
  const web = fakeReq({}, { cookies: { refresh_token: "from-cookie" }, body: { refreshToken: "from-body" } });
  assert.equal(readRefreshToken(web), "from-cookie");
  const mobile = fakeReq(
    { "X-Client-Type": "mobile" },
    { cookies: { refresh_token: "from-cookie" }, body: { refreshToken: "from-body" } }
  );
  assert.equal(readRefreshToken(mobile), "from-body");
});
