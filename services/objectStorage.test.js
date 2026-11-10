const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.AWS_REGION = "us-east-1";
process.env.S3_BUCKET_NAME = "test-bucket";

const { allowedTypes, verifyUploadedObject } = require("./objectStorage");

test("chat attachment allowlist accepts supported media and documents", () => {
  assert.equal(allowedTypes.has("image/png"), true);
  assert.equal(allowedTypes.has("video/mp4"), true);
  assert.equal(allowedTypes.has("application/pdf"), true);
});

test("chat attachment allowlist rejects executable and unrecognized content", () => {
  assert.equal(allowedTypes.has("application/x-msdownload"), false);
  assert.equal(allowedTypes.has("image/svg+xml"), false);
});

test("uploaded attachments must belong to the authenticated sender", async () => {
  await assert.rejects(
    verifyUploadedObject("chat/another-user/file.pdf", "current-user"),
    /does not belong to sender/
  );
});

const { buildObjectKey, folderForType, isUserChatKey } = require("./objectStorage");

test("chat uploads are stored in a folder per file type", () => {
  assert.equal(folderForType("image/jpeg"), "images");
  assert.equal(folderForType("video/mp4"), "videos");
  assert.equal(folderForType("audio/mpeg"), "audio");
  assert.equal(folderForType("application/pdf"), "documents");
  assert.equal(folderForType("text/plain"), "documents");

  const key = buildObjectKey({ purpose: "chat", userId: "u1", contentType: "video/mp4", fileName: "My clip.mp4" });
  assert.match(key, /^chat\/videos\/u1\/[0-9a-f-]{36}-My_clip\.mp4$/);
  assert.match(
    buildObjectKey({ purpose: "avatars", userId: "u1", contentType: "image/png", fileName: "me.png" }),
    /^avatars\/u1\/[0-9a-f-]{36}-me\.png$/
  );
});

test("chat key ownership accepts folder and legacy layouts only for the owner", () => {
  assert.equal(isUserChatKey("chat/images/u1/abc-photo.jpg", "u1"), true);
  assert.equal(isUserChatKey("chat/u1/abc-old.pdf", "u1"), true); // legacy layout
  assert.equal(isUserChatKey("chat/images/u2/abc-photo.jpg", "u1"), false);
  assert.equal(isUserChatKey("chat/u2/abc.pdf", "u1"), false);
  assert.equal(isUserChatKey("chat/images/u1", "u1"), false);
  assert.equal(isUserChatKey("avatars/u1/me.png", "u1"), false);
  assert.equal(isUserChatKey("chat/images/u1/../u2/x.jpg", "u1"), false);
});

test("uploads in another user's type folder are rejected", async () => {
  await assert.rejects(verifyUploadedObject("chat/documents/another-user/file.pdf", "current-user"), /does not belong to sender/);
});
