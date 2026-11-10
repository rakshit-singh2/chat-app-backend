const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema;

// A user's report of a message, for moderation review.
const reportSchema = new mongoose.Schema(
  {
    reporter: { type: ObjectId, ref: "User", required: true },
    chatType: { type: String, enum: ["direct", "group"], required: true },
    chatId: { type: ObjectId, required: true },
    messageId: { type: ObjectId, required: true },
    reportedUser: { type: ObjectId, ref: "User" },
    // Snapshot so the report survives deletion of the message.
    text: { type: String, maxlength: 10000 },
    file: { type: String },
    reason: { type: String, maxlength: 500 },
    status: { type: String, enum: ["open", "reviewed"], default: "open" },
  },
  { timestamps: true }
);

reportSchema.index({ reporter: 1, messageId: 1 }, { unique: true });

module.exports = mongoose.model("Report", reportSchema);
