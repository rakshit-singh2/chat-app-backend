"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-secret-that-is-definitely-longer-than-32-chars";

const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const {
  createSessionService,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  config,
} = require("./tokenService");

// Minimal in-memory stand-in for the Mongoose Session model.
function createFakeSessionModel() {
  const rows = [];
  let nextId = 1;
  const matches = (row, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === "object" && "$in" in value) {
        return value.$in.some((v) => String(v) === String(row[key]));
      }
      if (value === null) return row[key] == null;
      return String(row[key]) === String(value);
    });
  const apply = (row, update) => Object.assign(row, update);
  const query = (result) => {
    let list = result;
    const chain = {
      sort: () => chain,
      select: () => chain,
      skip: (n) => {
        list = list.slice().reverse().slice(n);
        return chain;
      },
      then: (resolve, reject) => Promise.resolve(list).then(resolve, reject),
    };
    return chain;
  };
  return {
    rows,
    async create(doc) {
      const row = { _id: nextId++, createdAt: new Date(), ...doc };
      rows.push(row);
      return row;
    },
    find: (filter) => query(rows.filter((r) => matches(r, filter))),
    async findOne(filter) {
      return rows.find((r) => matches(r, filter)) || null;
    },
    async findOneAndUpdate(filter, update) {
      const row = rows.find((r) => matches(r, filter));
      if (!row) return null;
      const before = { ...row };
      apply(row, update);
      return before;
    },
    async updateOne(filter, update) {
      const row = rows.find((r) => matches(r, filter));
      if (row) apply(row, update);
    },
    async updateMany(filter, update) {
      rows.filter((r) => matches(r, filter)).forEach((r) => apply(r, update));
    },
  };
}

test("access tokens round-trip and carry the user id", () => {
  const token = signAccessToken("user-1");
  const { userId, iat } = verifyAccessToken(token);
  assert.equal(userId, "user-1");
  assert.ok(Number.isInteger(iat));
});

test("rejects missing, expired, tampered and wrong-type tokens", () => {
  assert.throws(() => verifyAccessToken(undefined), { code: "TOKEN_MISSING" });

  const expired = jwt.sign({ type: "access" }, config.accessSecret, {
    subject: "u",
    expiresIn: -10,
    issuer: config.issuer,
    audience: config.audience,
  });
  assert.throws(() => verifyAccessToken(expired), { code: "TOKEN_EXPIRED" });

  const forged = jwt.sign({ type: "access" }, "another-secret-another-secret-another", {
    subject: "u",
    issuer: config.issuer,
    audience: config.audience,
  });
  assert.throws(() => verifyAccessToken(forged), { code: "TOKEN_INVALID" });

  const legacy = jwt.sign({ userId: "u" }, config.accessSecret); // old token format
  assert.throws(() => verifyAccessToken(legacy), { code: "TOKEN_INVALID" });
});

test("stores only a hash of the refresh token", async () => {
  const Session = createFakeSessionModel();
  const { issueSession } = createSessionService(Session);
  const tokens = await issueSession("user-1", { client: "mobile" });

  assert.equal(Session.rows.length, 1);
  assert.equal(Session.rows[0].tokenHash, hashToken(tokens.refreshToken));
  assert.ok(!JSON.stringify(Session.rows).includes(tokens.refreshToken));
  assert.equal(Session.rows[0].client, "mobile");
});

test("rotation issues a new pair and invalidates the old refresh token", async () => {
  const Session = createFakeSessionModel();
  const { issueSession, rotateSession } = createSessionService(Session);
  const first = await issueSession("user-1");

  const second = await rotateSession(first.refreshToken);
  assert.equal(second.userId, "user-1");
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal(verifyAccessToken(second.accessToken).userId, "user-1");

  // The new token works once more.
  await rotateSession(second.refreshToken);
});

test("replaying a rotated refresh token revokes the whole family", async () => {
  const Session = createFakeSessionModel();
  const { issueSession, rotateSession } = createSessionService(Session);
  const stolen = await issueSession("user-1");
  const legit = await rotateSession(stolen.refreshToken);

  await assert.rejects(rotateSession(stolen.refreshToken), { code: "REFRESH_REVOKED" });
  // The legitimate holder is signed out too.
  await assert.rejects(rotateSession(legit.refreshToken), { code: "REFRESH_REVOKED" });
});

test("rejects unknown, expired and revoked refresh tokens", async () => {
  const Session = createFakeSessionModel();
  const { issueSession, rotateSession, revokeSession, revokeAllSessions } =
    createSessionService(Session);

  await assert.rejects(rotateSession(undefined), { code: "REFRESH_MISSING" });
  await assert.rejects(rotateSession("nope"), { code: "REFRESH_INVALID" });

  const a = await issueSession("user-1");
  Session.rows[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(rotateSession(a.refreshToken), { code: "REFRESH_EXPIRED" });

  const b = await issueSession("user-1");
  await revokeSession(b.refreshToken);
  await assert.rejects(rotateSession(b.refreshToken), { code: "REFRESH_REVOKED" });

  const c = await issueSession("user-1");
  const d = await issueSession("user-1");
  await revokeAllSessions("user-1");
  await assert.rejects(rotateSession(c.refreshToken), { code: "REFRESH_REVOKED" });
  await assert.rejects(rotateSession(d.refreshToken), { code: "REFRESH_REVOKED" });
});

test("access tokens embed the user's token version", async () => {
  assert.equal(verifyAccessToken(signAccessToken("u", 3)).tokenVersion, 3);
  assert.equal(verifyAccessToken(signAccessToken("u")).tokenVersion, 0);

  const Session = createFakeSessionModel();
  const { issueSession } = createSessionService(Session, async () => 7);
  const { accessToken } = await issueSession("u");
  assert.equal(verifyAccessToken(accessToken).tokenVersion, 7);
});
