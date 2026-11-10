const mongoose = require("mongoose");

// One push target per device. Browsers use Web Push (endpoint + keys); the
// React Native app can later register FCM/APNs device tokens here as well.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: "User", required: true, index: true },
    platform: { type: String, enum: ["web", "fcm", "apns"], default: "web" },
    endpoint: { type: String, required: true, unique: true, maxlength: 2048 },
    keys: {
      p256dh: { type: String, maxlength: 512 },
      auth: { type: String, maxlength: 512 },
    },
    userAgent: { type: String, maxlength: 512 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
