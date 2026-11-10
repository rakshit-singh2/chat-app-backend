"use strict";

// bcrypt only uses the first 72 bytes of a password, so longer input is rejected
// instead of being silently truncated.
const MIN_LENGTH = 8;
const MAX_BYTES = 72;

function validatePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required.";
  }
  if (password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_BYTES) {
    return `Password must be at most ${MAX_BYTES} bytes.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Password must include an uppercase letter, a lowercase letter and a number.";
  }
  return null;
}

module.exports = { validatePassword, MIN_LENGTH, MAX_BYTES };
