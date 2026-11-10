const { randomUUID } = require("crypto");
const path = require("path");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const bucket = process.env.S3_BUCKET_NAME;
// Only add checksums when S3 requires them. Newer SDKs otherwise put a
// checksum of an empty body into presigned PUT URLs, so browser uploads of the
// real file would be rejected.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const allowedTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "application/zip",
]);

// Errors with a clear, user-facing message (shown by the API error handler).
class StorageError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = "StorageError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

const NOT_CONFIGURED_MESSAGE =
  "File sharing isn't set up on the server yet. Ask the administrator to configure AWS S3 credentials.";

// Translate AWS SDK failures into StorageErrors.
function toStorageError(error) {
  if (error instanceof StorageError) return error;
  const name = error?.name || "";
  const status = error?.$metadata?.httpStatusCode;
  if (name === "CredentialsProviderError" || /Could not load credentials/i.test(error?.message)) {
    return new StorageError(NOT_CONFIGURED_MESSAGE, 503, "STORAGE_NOT_CONFIGURED");
  }
  if (["InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken", "InvalidToken"].includes(name)) {
    return new StorageError(
      "File storage is misconfigured on the server (invalid AWS credentials).",
      503,
      "STORAGE_NOT_CONFIGURED"
    );
  }
  if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
    return new StorageError("The file upload didn't finish. Please try again.", 400, "UPLOAD_NOT_FOUND");
  }
  if (name === "AccessDenied" || name === "Forbidden" || status === 403) {
    return new StorageError("The server can't access file storage. Check the S3 bucket permissions.", 503, "STORAGE_ACCESS_DENIED");
  }
  if (name === "NoSuchBucket") {
    return new StorageError("The configured S3 bucket doesn't exist.", 503, "STORAGE_NOT_CONFIGURED");
  }
  return error;
}

function requireBucket() {
  if (!bucket || !process.env.AWS_REGION) {
    throw new StorageError(NOT_CONFIGURED_MESSAGE, 503, "STORAGE_NOT_CONFIGURED");
  }
}

// Called at startup: warn early if uploads cannot work.
async function checkStorageConfig() {
  if (!bucket || !process.env.AWS_REGION) {
    return { ok: false, reason: "S3_BUCKET_NAME and AWS_REGION are not set" };
  }
  try {
    await s3.config.credentials();
  } catch {
    return {
      ok: false,
      reason:
        "no AWS credentials found (set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, an AWS profile, or an IAM role)",
    };
  }
  // Read a key that does not exist. GET (unlike HEAD) returns an error code:
  // NoSuchKey / AccessDenied mean the credentials are valid and the bucket
  // exists; other codes name the problem.
  try {
    await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "__storage-health-check__" }));
  } catch (error) {
    const name = error?.name || error?.Code || "";
    const status = error?.$metadata?.httpStatusCode;
    if (["NoSuchKey", "NotFound", "AccessDenied"].includes(name)) return { ok: true };
    if (["InvalidAccessKeyId", "SignatureDoesNotMatch"].includes(name)) {
      return { ok: false, reason: `AWS rejected the credentials (${name}); check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY` };
    }
    if (name === "NoSuchBucket" || status === 301) {
      return { ok: false, reason: `bucket "${bucket}" not found in region ${process.env.AWS_REGION}` };
    }
    return { ok: false, reason: `S3 check failed (${name || status || error.message})` };
  }
  return { ok: true };
}

// Chat uploads are grouped by type in the bucket:
//   chat/images/<userId>/…, chat/videos/<userId>/…, chat/audio/<userId>/…,
//   chat/documents/<userId>/…    (avatars stay in avatars/<userId>/…)
const CHAT_FOLDERS = ["images", "videos", "audio", "documents"];

function folderForType(contentType = "") {
  if (contentType.startsWith("image/")) return "images";
  if (contentType.startsWith("video/")) return "videos";
  if (contentType.startsWith("audio/")) return "audio";
  return "documents";
}

// Build the object key for an upload.
function buildObjectKey({ purpose, userId, contentType, fileName }) {
  const name = `${randomUUID()}-${safeFilename(fileName)}`;
  if (purpose === "chat") return `chat/${folderForType(contentType)}/${userId}/${name}`;
  return `${purpose}/${userId}/${name}`;
}

// True when `key` is a chat upload made by `userId`. Accepts the type-folder
// layout and the older chat/<userId>/… layout used before folders existed.
function isUserChatKey(key, userId) {
  if (typeof key !== "string" || !userId || key.includes("..")) return false;
  const parts = key.split("/");
  if (parts[0] !== "chat") return false;
  if (CHAT_FOLDERS.includes(parts[1])) return parts[2] === String(userId) && parts.length >= 4;
  return parts[1] === String(userId) && parts.length >= 3;
}

function safeFilename(filename) {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function createUploadUrl({ userId, fileName, contentType, contentLength, purpose }) {
  requireBucket();
  if (!allowedTypes.has(contentType)) {
    throw new StorageError(
      "This file type isn't supported. Send images, videos (MP4, WebM, MOV), audio, PDF, Office documents, text or ZIP files.",
      400,
      "UNSUPPORTED_FILE_TYPE"
    );
  }

  const key = buildObjectKey({ purpose, userId, contentType, fileName });
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  try {
    return { key, uploadUrl: await getSignedUrl(s3, command, { expiresIn: 300 }) };
  } catch (error) {
    throw toStorageError(error);
  }
}

async function createDownloadUrl(key) {
  requireBucket();
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 900 });
  } catch (error) {
    throw toStorageError(error);
  }
}

async function verifyUploadedObject(key, userId) {
  requireBucket();
  if (!isUserChatKey(key, userId)) {
    throw new Error("Attachment does not belong to sender");
  }
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    throw toStorageError(error);
  }
}

module.exports = {
  CHAT_FOLDERS,
  buildObjectKey,
  folderForType,
  isUserChatKey,
  StorageError,
  checkStorageConfig,
  allowedTypes,
  createUploadUrl,
  createDownloadUrl,
  verifyUploadedObject,
};
