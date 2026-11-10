const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, "First Name is required"],
  },
  lastName: {
    type: String,
    required: [true, "Last Name is required"],
  },
  about: {
    type: String,
  },
  avatar: {
    type: String,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    unique: true,
    validate: {
      validator: function (email) {
        return String(email)
          .toLowerCase()
          .match(
            /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
          );
      },
      message: (props) => `Email (${props.value}) is invalid!`,
    },
  },
  password: {
    type: String,
    select: false,
  },
  passwordChangedAt: {
    // unselect
    type: Date,
  },
  passwordResetToken: {
    type: String,
    select: false,
  },
  passwordResetExpires: {
    // unselect
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    // unselect
    type: Date,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  otp: {
    type: String,
    select: false,
  },
  otp_expiry_time: {
    type: Date,
  },
  // Failed verification attempts for the current OTP.
  otp_attempts: {
    type: Number,
    default: 0,
  },
  otp_last_sent_at: {
    type: Date,
  },
  // Embedded in access tokens; incrementing it invalidates every issued access
  // token immediately (password change/reset, logout everywhere).
  tokenVersion: {
    type: Number,
    default: 0,
  },
  friends: [
    {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  ],
  // Users this user has blocked: no messages, requests or calls either way.
  blocked: [
    {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  ],
  settings: {
    notifications: {
      messages: { type: Boolean, default: true },
      groups: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
      // Friend requests, accepted requests, group invites.
      activity: { type: Boolean, default: true },
      preview: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
    },
    wallpaper: { type: String, default: "default", maxlength: 32 },
  },
  socket_id: {
    type: String
  },
  status: {
    type: String,
    enum: ["Online", "Offline"]
  },
  // When the user last disconnected (for "last seen").
  lastSeen: {
    type: Date,
  }
});

userSchema.pre("save", async function () {
  // Only run this function if password was actually modified
  if (!this.isModified("otp") || !this.otp) return;

  // Hash the otp with cost of 12
  this.otp = await bcrypt.hash(this.otp.toString(), 12);

  // console.log(this.otp.toString(), "FROM PRE SAVE HOOK");

});

userSchema.pre("save", async function () {
  // Only run this function if password was actually modified
  if (!this.isModified("password") || !this.password) return;

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, Number(process.env.BCRYPT_ROUNDS) || 12);

  //! Shift it to next hook // this.passwordChangedAt = Date.now() - 1000;

});

userSchema.pre("save", function () {
  if (!this.isModified("password") || this.isNew || !this.password)
    return;

  this.passwordChangedAt = Date.now() - 1000;
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.correctOTP = async function (candidateOTP, userOTP) {
  return await bcrypt.compare(candidateOTP, userOTP);
};

userSchema.methods.changedPasswordAfter = function (JWTTimeStamp) {
  if (this.passwordChangedAt) {
    const changedTimeStamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimeStamp < changedTimeStamp;
  }

  // FALSE MEANS NOT CHANGED
  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

// Never serialise secrets, even when a full document is sent with res.json or
// over Socket.IO.
const SENSITIVE_FIELDS = [
  "password",
  "passwordChangedAt",
  "passwordResetToken",
  "passwordResetExpires",
  "otp",
  "otp_expiry_time",
  "otp_attempts",
  "otp_last_sent_at",
  "tokenVersion",
  "socket_id",
  "__v",
];
const hideSensitive = (doc, ret) => {
  for (const field of SENSITIVE_FIELDS) delete ret[field];
  return ret;
};
userSchema.set("toJSON", { transform: hideSensitive });

const User = mongoose.model("User", userSchema);
module.exports = User;