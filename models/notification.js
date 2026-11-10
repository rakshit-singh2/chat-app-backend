const mongoose = require("mongoose");

// An entry in a user's notification centre (activity that isn't a chat message).
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["friend_request", "request_accepted", "missed_call", "group_added"],
      required: true,
    },
    actor: { type: mongoose.Schema.ObjectId, ref: "User" },
    title: { type: String, maxlength: 200 },
    body: { type: String, maxlength: 500 },
    // Context for actions: request_id, call_id + media, chat_type + chat_id.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
// Old notifications are removed automatically after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model("Notification", notificationSchema);
