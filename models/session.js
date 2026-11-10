const mongoose = require("mongoose");

// One document per signed-in device. Only a SHA-256 hash of the refresh token
// is stored, so a database leak does not expose usable tokens.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // All rotations of one login share a family; reusing a rotated token
    // revokes the whole family (refresh-token theft detection).
    family: { type: String, required: true, index: true },
    client: { type: String, enum: ["web", "mobile"], default: "web" },
    userAgent: { type: String, maxlength: 512 },
    ip: { type: String, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date },
    replacedBy: { type: String },
  },
  { timestamps: true }
);

// MongoDB deletes sessions automatically once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Session", sessionSchema);
