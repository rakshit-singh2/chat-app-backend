const mongoose = require("mongoose");

const videoCallSchema = new mongoose.Schema({
  participants: [
    {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  ],
  from: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
  to: {
    type: mongoose.Schema.ObjectId,
    ref: "User",
  },
  verdict: {
    type: String,
    enum: ["Accepted", "Denied", "Missed", "Busy"],
  },
  status: {
    type: String,
    enum: ["Ongoing", "Ended"],
  },
  provider: {
    type: String,
    enum: ["AGORA", "MEDIASOUP"],
    default: "AGORA",
  },
  startedAt: {
    type: Date,
    default: Date.now(),
  },
  endedAt: {
    type: Date,
  },
});

const VideoCall = mongoose.model("VideoCall", videoCallSchema);
module.exports = VideoCall;