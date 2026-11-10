const mongoose = require("mongoose");
const { messageSchema, chatStateFields } = require("./chatSchemas");

const oneToOneMessageSchema = new mongoose.Schema({
  participants: [
    {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  ],
  messages: [messageSchema],
  ...chatStateFields,
});

oneToOneMessageSchema.index({ participants: 1 });

const OneToOneMessage = mongoose.model(
  "OneToOneMessage",
  oneToOneMessageSchema
);
module.exports = OneToOneMessage;
