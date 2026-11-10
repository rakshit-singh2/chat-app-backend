const mongoose = require("mongoose");

const { ObjectId } = mongoose.Schema;

// One message, shared by direct conversations and groups.
const messageSchema = new mongoose.Schema({
  to: { type: ObjectId, ref: "User" }, // direct chats only
  from: { type: ObjectId, ref: "User", required: true },
  type: {
    type: String,
    enum: ["Text", "Media", "Document", "Link"],
    default: "Text",
  },
  created_at: { type: Date, default: Date.now },
  text: { type: String, maxlength: 10000 },
  file: { type: String },
  // MIME type of the attachment (image/jpeg, video/mp4, ...), for rendering.
  mimeType: { type: String, maxlength: 100 },
  // Attachment size in bytes and original file name.
  fileSize: { type: Number },
  fileName: { type: String, maxlength: 255 },
  // Snapshot of the message being replied to.
  replyTo: {
    messageId: { type: ObjectId },
    from: { type: ObjectId, ref: "User" },
    text: { type: String, maxlength: 300 },
    type: { type: String },
  },
  forwarded: { type: Boolean, default: false },
  reactions: [
    {
      _id: false,
      user: { type: ObjectId, ref: "User" },
      emoji: { type: String, maxlength: 16 },
    },
  ],
  starredBy: [{ type: ObjectId, ref: "User" }],
  deletedFor: [{ type: ObjectId, ref: "User" }],
  deletedForEveryone: { type: Boolean, default: false },
});

// Per-user conversation state, shared by direct conversations and groups.
const userTimestamp = new mongoose.Schema(
  { user: { type: ObjectId, ref: "User" }, at: { type: Date, default: Date.now } },
  { _id: false }
);

const chatStateFields = {
  pinnedBy: [{ type: ObjectId, ref: "User" }],
  archivedBy: [{ type: ObjectId, ref: "User" }],
  mutedBy: [{ type: ObjectId, ref: "User" }],
  // Messages after lastRead count as unread.
  lastRead: [userTimestamp],
  // "Delete chat" hides everything up to this point for that user.
  clearedAt: [userTimestamp],
};

module.exports = { messageSchema, chatStateFields };
