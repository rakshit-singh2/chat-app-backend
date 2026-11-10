"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const spec = require("./openapi");

const projectRoot = path.resolve(__dirname, "..");

test("documents every mounted authentication and user REST route", () => {
  const actualOperations = new Set();
  for (const [file, prefix] of [
    ["routes/auth.js", "/auth"],
    ["routes/user.js", "/user"],
  ]) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    for (const [, method, route] of source.matchAll(
      /router\.(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']/g
    )) {
      actualOperations.add(`${method.toLowerCase()} ${prefix}${route}`);
    }
  }

  const documentedOperations = new Set(
    Object.entries(spec.paths).flatMap(([route, operations]) =>
      Object.keys(operations).map((method) => `${method} ${route}`)
    )
  );
  assert.deepEqual(
    [...documentedOperations].sort(),
    [...actualOperations].sort()
  );
});
