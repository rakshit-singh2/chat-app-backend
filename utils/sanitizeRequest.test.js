"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sanitizeRequest = require("./sanitizeRequest");

function makeReq({ body, params, query }) {
  const req = { body, params };
  // Mimic Express 5: `query` is a getter without a setter.
  Object.defineProperty(req, "query", { get: () => query, configurable: true, enumerable: true });
  return req;
}

test("does not throw on Express 5 read-only req.query", () => {
  const req = makeReq({ body: {}, params: {}, query: { q: "hi" } });
  assert.doesNotThrow(() => sanitizeRequest()(req, {}, () => {}));
  assert.deepEqual(req.query, { q: "hi" });
});

test("strips MongoDB operators from body, params and query", () => {
  const req = makeReq({
    body: { email: { $gt: "" }, password: "x" },
    params: { id: { $ne: null } },
    query: { "a.b": "1", $where: "1" },
  });
  sanitizeRequest()(req, {}, () => {});
  assert.deepEqual(req.body, { email: {}, password: "x" });
  assert.deepEqual(req.params, { id: {} });
  assert.deepEqual(req.query, {});
});

test("escapes XSS payloads", () => {
  const req = makeReq({ body: { firstName: "<script>alert(1)</script>" }, params: {}, query: {} });
  sanitizeRequest()(req, {}, () => {});
  assert.ok(!req.body.firstName.includes("<script>"));
});

test("calls next exactly once", () => {
  let calls = 0;
  sanitizeRequest()(makeReq({ body: {}, params: {}, query: {} }), {}, () => calls++);
  assert.equal(calls, 1);
});
