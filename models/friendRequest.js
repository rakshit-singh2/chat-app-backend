const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
  recipient: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

requestSchema.index({ sender: 1, recipient: 1 }, { unique: true });
requestSchema.index({ recipient: 1 });

const FriendRequest = mongoose.model("FriendRequest", requestSchema);
module.exports = FriendRequest;