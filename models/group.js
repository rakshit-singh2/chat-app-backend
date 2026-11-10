const mongoose = require("mongoose");
const { messageSchema, chatStateFields } = require("./chatSchemas");

const { ObjectId } = mongoose.Schema;

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    about: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: ObjectId, ref: "User", required: true },
    admins: [{ type: ObjectId, ref: "User" }],
    members: [{ type: ObjectId, ref: "User" }],
    messages: [messageSchema],
    ...chatStateFields,
  },
  { timestamps: true }
);

groupSchema.index({ members: 1 });

module.exports = mongoose.model("Group", groupSchema);
