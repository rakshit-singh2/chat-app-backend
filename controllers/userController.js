const AudioCall = require("../models/audioCall");
const FriendRequest = require("../models/friendRequest");
const User = require("../models/user");
const VideoCall = require("../models/videoCall");
const mongoose = require("mongoose");
const catchAsync = require("../utils/catchAsync");
const filterObj = require("../utils/filterObj");
const AppError = require("../utils/AppError");
const {
  getCallProvider,
  getCallProviderInfo,
  createCallCredentials,
} = require("../services/callProvider");
const { prepareRoom } = require("../services/mediasoupServer");
const { createUploadUrl, createDownloadUrl } = require("../services/objectStorage");
const OneToOneMessage = require("../models/OneToOneMessage");
const Group = require("../models/group");
const Notification = require("../models/notification");
const PushSubscription = require("../models/pushSubscription");
const { isPushConfigured, listNotifications } = require("../services/notificationService");

const includesId = (list = [], id) => list.some((item) => String(item?._id ?? item) === String(id));


exports.getMe = catchAsync(async (req, res, next) => {
  res.status(200).json({
    status: "success",
    data: req.user,
  });
});

exports.createChatAttachmentUploadUrl = catchAsync(async (req, res) => {
    const { fileName, contentType, contentLength } = req.body;
    if (
      typeof fileName !== "string" ||
      !fileName.trim() ||
      !Number.isInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > 25 * 1024 * 1024
    ) {
      return res.status(400).json({
        status: "error",
        message: "A file name and a file between 1 byte and 25 MB are required.",
      });
    }

    const { key, uploadUrl } = await createUploadUrl({
      userId: req.user._id.toString(),
      fileName,
      contentType,
      contentLength,
      purpose: "chat",
    });

    res.status(200).json({ status: "success", data: { key, uploadUrl } });
  });

exports.createAvatarUploadUrl = catchAsync(async (req, res) => {
    const { fileName, contentType, contentLength } = req.body;
    if (
      typeof fileName !== "string" ||
      !fileName.trim() ||
      !["image/gif", "image/jpeg", "image/png", "image/webp"].includes(contentType) ||
      !Number.isInteger(contentLength) ||
      contentLength < 1 ||
      contentLength > 3 * 1024 * 1024
    ) {
      return res.status(400).json({
        status: "error",
        message: "Choose a supported image that is 3 MB or smaller.",
      });
    }

    const { key, uploadUrl } = await createUploadUrl({
      userId: req.user._id.toString(),
      fileName,
      contentType,
      contentLength,
      purpose: "avatars",
    });
    res.status(200).json({ status: "success", data: { key, uploadUrl } });
  });

exports.createChatAttachmentDownloadUrl = catchAsync(async (req, res) => {
    const { conversationId, key, chatType } = req.body;
    if (!mongoose.isValidObjectId(conversationId)) {
      return res.status(404).json({ status: "error", message: "Attachment not found." });
    }
    const conversation = chatType === "group"
      ? await Group.findOne({
          _id: conversationId,
          members: req.user._id,
          messages: { $elemMatch: { file: key } },
        }).select("_id")
      : await OneToOneMessage.findOne({
          _id: conversationId,
          participants: req.user._id,
          messages: { $elemMatch: { file: key } },
        }).select("_id");

    if (!conversation || typeof key !== "string" || !key.startsWith("chat/")) {
      return res.status(404).json({
        status: "error",
        message: "Attachment not found.",
      });
    }

    const url = await createDownloadUrl(key);
    res.status(200).json({ status: "success", data: { url } });
});

exports.updateMe = catchAsync(async (req, res, next) => {
  const filteredBody = filterObj(
    req.body,
    "firstName",
    "lastName",
    "about",
    "avatar"
  );

  // Only accept avatar keys issued to this user by /user/avatar-upload-url.
  if (
    filteredBody.avatar !== undefined &&
    (typeof filteredBody.avatar !== "string" ||
      !filteredBody.avatar.startsWith(`avatars/${req.user._id}/`) ||
      filteredBody.avatar.includes(".."))
  ) {
    throw new AppError("Invalid avatar.", 400, "INVALID_AVATAR");
  }

  const userDoc = await User.findByIdAndUpdate(req.user._id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: "success",
    data: userDoc,
    message: "User Updated successfully",
  });
});

// Users you can send a friend request to: verified, not you, not already a
// friend. `request` is "sent" or "received" when a request is pending.
exports.getUsers = catchAsync(async (req, res, next) => {
  const me = String(req.user._id);
  const friendIds = new Set(req.user.friends.map(String));

  const [all_users, pending] = await Promise.all([
    User.find({
      verified: true,
      _id: { $ne: req.user._id, $nin: req.user.blocked || [] },
      blocked: { $ne: req.user._id },
    }).select("firstName lastName avatar status _id"),
    FriendRequest.find({ $or: [{ sender: me }, { recipient: me }] }).select("sender recipient"),
  ]);
  const requestState = new Map();
  for (const request of pending) {
    if (String(request.sender) === me) requestState.set(String(request.recipient), "sent");
    else requestState.set(String(request.sender), "received");
  }

  const remaining_users = all_users
    .filter((user) => !friendIds.has(String(user._id)))
    .map((user) => ({ ...user.toJSON(), request: requestState.get(String(user._id)) || null }));

  res.status(200).json({
    status: "success",
    data: remaining_users,
    message: "Users found successfully!",
  });
});

exports.getAllVerifiedUsers = catchAsync(async (req, res, next) => {
  const all_users = await User.find({
    verified: true,
  }).select("firstName lastName _id");

  const remaining_users = all_users.filter(
    (user) => user._id.toString() !== req.user._id.toString()
  );

  res.status(200).json({
    status: "success",
    data: remaining_users,
    message: "Users found successfully!",
  });
});
exports.getRequests = catchAsync(async (req, res, next) => {
  const requests = await FriendRequest.find({ recipient: req.user._id })
    .sort({ createdAt: -1 })
    .populate("sender", "_id firstName lastName avatar status");

  res.status(200).json({
    status: "success",
    data: requests,
    message: "Requests found successfully!",
  });
});

exports.getFriends = catchAsync(async (req, res, next) => {
  const this_user = await User.findById(req.user._id).populate(
    "friends",
    "_id firstName lastName avatar status lastSeen"
  );
  res.status(200).json({
    status: "success",
    data: this_user.friends,
    message: "Friends found successfully!",
  });
});

/**
 * Authorization authentication token generation
 */

/**
 * Legacy call-token endpoint removed
 *   post:
 *     summary: Generate call authorization token
 *     tags: [Token]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema:
 *           type: string
 *           example: "Bearer YOUR_TOKEN_HERE"
 *         description: Bearer token for authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               room_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully generated token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *               example:
 *                 status: "success"
 *                 message: "Token generated successfully"
 *                 token: "token_value_here"
 */
exports.getCallProvider = catchAsync(async (_req, res) => {
  res.status(200).json({
    status: "success",
    data: getCallProviderInfo(),
  });
});

exports.getCallCredentials = catchAsync(async (req, res) => {
  const { callId } = req.body;
  if (!mongoose.isValidObjectId(callId)) {
    throw new AppError("A valid call ID is required.", 400);
  }

  let call = await AudioCall.findById(callId);
  if (!call) call = await VideoCall.findById(callId);
  if (
    !call ||
    call.status !== "Ongoing" ||
    !call.participants.some((participant) => String(participant) === String(req.user._id))
  ) {
    throw new AppError("Call not found or access is not permitted.", 404);
  }

  const provider = call.provider || getCallProvider();
  const credentials = await createCallCredentials({
    provider,
    roomId: String(call._id),
    userId: String(req.user._id),
    userName: `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || String(req.user._id),
  });
  res.status(200).json({ status: "success", data: credentials });
});

async function validateCallProviderConfiguration(provider, user, roomId) {
  await createCallCredentials({
    provider,
    roomId,
    userId: String(user._id),
    userName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || String(user._id),
  });
}

async function prepareMediasoupCall(provider, call, Model) {
  if (provider !== "MEDIASOUP") return;
  try {
    await prepareRoom(String(call._id));
  } catch (error) {
    await Model.findByIdAndUpdate(call._id, {
      verdict: "Busy",
      status: "Ended",
      endedAt: Date.now(),
    });
    throw error;
  }
}

exports.startAudioCall = catchAsync(async (req, res, next) => {
  const from = req.user._id;
  const to = req.body.id;
  if (!mongoose.isValidObjectId(to) || String(to) === String(from)) {
    throw new AppError("A valid call recipient is required.", 400);
  }
  const [from_user, to_user] = await Promise.all([
    User.findById(from).select("firstName lastName avatar friends blocked"),
    User.findById(to).select("firstName lastName avatar blocked"),
  ]);
  if (!from_user || !to_user) throw new AppError("Call participant not found.", 404);
  if (!from_user.friends.some((friend) => String(friend) === String(to))) {
    throw new AppError("Calls are only available between friends.", 403);
  }
  if (includesId(from_user.blocked, to) || includesId(to_user.blocked, from)) {
    throw new AppError("You can't call this user.", 403, "BLOCKED");
  }
  const provider = getCallProvider();
  await validateCallProviderConfiguration(provider, from_user, "provider-validation");

  // create a new call audioCall Doc and send required data to client
  const new_audio_call = await AudioCall.create({
    participants: [from, to],
    from,
    to,
    status: "Ongoing",
    provider,
  });
  await prepareMediasoupCall(provider, new_audio_call, AudioCall);

  res.status(200).json({
    data: {
      from_user: to_user,
      callId: String(new_audio_call._id),
      roomID: String(new_audio_call._id),
      provider,
      userID: from,
      peerID: to,
      userName: `${from_user.firstName} ${from_user.lastName}`.trim(),
    },
  });
});

exports.startVideoCall = catchAsync(async (req, res, next) => {
  const from = req.user._id;
  const to = req.body.id;
  if (!mongoose.isValidObjectId(to) || String(to) === String(from)) {
    throw new AppError("A valid call recipient is required.", 400);
  }
  const [from_user, to_user] = await Promise.all([
    User.findById(from).select("firstName lastName avatar friends blocked"),
    User.findById(to).select("firstName lastName avatar blocked"),
  ]);
  if (!from_user || !to_user) throw new AppError("Call participant not found.", 404);
  if (!from_user.friends.some((friend) => String(friend) === String(to))) {
    throw new AppError("Calls are only available between friends.", 403);
  }
  if (includesId(from_user.blocked, to) || includesId(to_user.blocked, from)) {
    throw new AppError("You can't call this user.", 403, "BLOCKED");
  }
  const provider = getCallProvider();
  await validateCallProviderConfiguration(provider, from_user, "provider-validation");

  // create a new call videoCall Doc and send required data to client
  const new_video_call = await VideoCall.create({
    participants: [from, to],
    from,
    to,
    status: "Ongoing",
    provider,
  });
  await prepareMediasoupCall(provider, new_video_call, VideoCall);

  res.status(200).json({
    data: {
      from_user: to_user,
      callId: String(new_video_call._id),
      roomID: String(new_video_call._id),
      provider,
      userID: from,
      peerID: to,
      userName: `${from_user.firstName} ${from_user.lastName}`.trim(),
    },
  });
});

exports.getCallLogs = catchAsync(async (req, res) => {
  const me = String(req.user._id);
  const [audio, video] = await Promise.all([
    AudioCall.find({ participants: req.user._id })
      .sort({ startedAt: -1 })
      .limit(100)
      .populate("from to", "firstName lastName avatar status"),
    VideoCall.find({ participants: req.user._id })
      .sort({ startedAt: -1 })
      .limit(100)
      .populate("from to", "firstName lastName avatar status"),
  ]);

  const toLog = (call, type) => {
    const incoming = String(call.from?._id) !== me;
    const other = incoming ? call.from : call.to;
    return {
      id: call._id,
      type,
      user_id: other?._id,
      name: other ? `${other.firstName} ${other.lastName}` : "Unknown user",
      img: other?.avatar,
      online: other?.status === "Online",
      incoming,
      missed: call.verdict !== "Accepted",
      verdict: call.verdict || (call.status === "Ongoing" ? "Ongoing" : "Missed"),
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    };
  };

  const data = [...audio.map((c) => toLog(c, "audio")), ...video.map((c) => toLog(c, "video"))]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 100);

  res.status(200).json({ status: "success", data });
});


// ----------------------------------------------------------------------
// Blocking

exports.getBlocked = catchAsync(async (req, res) => {
  const me = await User.findById(req.user._id).populate("blocked", "_id firstName lastName avatar");
  res.status(200).json({ status: "success", data: me.blocked });
});

exports.blockUser = catchAsync(async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId) || String(userId) === String(req.user._id)) {
    throw new AppError("A valid user is required.", 400, "VALIDATION_ERROR");
  }
  if (!(await User.exists({ _id: userId }))) throw new AppError("User not found.", 404, "NOT_FOUND");
  await User.updateOne({ _id: req.user._id }, { $addToSet: { blocked: userId } });
  // Pending requests between the two are dropped.
  await FriendRequest.deleteMany({
    $or: [
      { sender: req.user._id, recipient: userId },
      { sender: userId, recipient: req.user._id },
    ],
  });
  res.status(200).json({ status: "success", message: "User blocked." });
});

exports.unblockUser = catchAsync(async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId)) {
    throw new AppError("A valid user is required.", 400, "VALIDATION_ERROR");
  }
  await User.updateOne({ _id: req.user._id }, { $pull: { blocked: userId } });
  res.status(200).json({ status: "success", message: "User unblocked." });
});

// ----------------------------------------------------------------------
// Settings and data export

const NOTIFICATION_KEYS = ["messages", "groups", "calls", "activity", "preview", "sound"];
const WALLPAPERS = ["default", "plain", "sky", "mint", "sand", "rose", "night"];

exports.updateSettings = catchAsync(async (req, res) => {
  const update = {};
  const notifications = req.body?.notifications;
  if (notifications && typeof notifications === "object") {
    for (const key of NOTIFICATION_KEYS) {
      if (typeof notifications[key] === "boolean") update[`settings.notifications.${key}`] = notifications[key];
    }
  }
  if (req.body?.wallpaper !== undefined) {
    if (!WALLPAPERS.includes(req.body.wallpaper)) {
      throw new AppError("Unknown wallpaper.", 400, "VALIDATION_ERROR");
    }
    update["settings.wallpaper"] = req.body.wallpaper;
  }
  if (!Object.keys(update).length) throw new AppError("Nothing to update.", 400, "VALIDATION_ERROR");
  const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
  res.status(200).json({ status: "success", message: "Settings saved.", data: user.settings });
});

// Everything the app stores about the user, as a JSON download.
exports.exportMyData = catchAsync(async (req, res) => {
  const me = String(req.user._id);
  const [user, conversations, groups, audio, video] = await Promise.all([
    User.findById(me).populate("friends blocked", "firstName lastName email"),
    OneToOneMessage.find({ participants: me }).populate("participants", "firstName lastName email"),
    Group.find({ members: me }).populate("members", "firstName lastName"),
    AudioCall.find({ participants: me }).select("from to verdict status startedAt endedAt"),
    VideoCall.find({ participants: me }).select("from to verdict status startedAt endedAt"),
  ]);
  const myMessages = (chat) =>
    chat.messages
      .filter((m) => String(m.from) === me && !m.deletedForEveryone)
      .map((m) => ({ sent_at: m.created_at, type: m.type, text: m.text, file: m.file }));

  const data = {
    exported_at: new Date().toISOString(),
    profile: {
      id: me,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      about: user.about,
      createdAt: user.createdAt,
      settings: user.settings,
    },
    friends: user.friends.map((f) => ({ name: `${f.firstName} ${f.lastName}`, email: f.email })),
    blocked: user.blocked.map((b) => ({ name: `${b.firstName} ${b.lastName}` })),
    conversations: conversations.map((c) => ({
      with: c.participants.filter((p) => String(p._id) !== me).map((p) => `${p.firstName} ${p.lastName}`),
      messages_sent: myMessages(c),
    })),
    groups: groups.map((g) => ({ name: g.name, messages_sent: myMessages(g) })),
    calls: [...audio.map((c) => ({ type: "audio", ...c.toObject() })), ...video.map((c) => ({ type: "video", ...c.toObject() }))],
  };
  res.setHeader("Content-Disposition", `attachment; filename="chat-app-data-${me}.json"`);
  res.status(200).json(data);
});


// ----------------------------------------------------------------------
// Notification centre

exports.getNotifications = catchAsync(async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const data = await listNotifications(req.user._id, { limit });
  res.status(200).json({ status: "success", data });
});

// Body: { ids: [...] } marks those read; no ids marks everything read.
exports.markNotificationsRead = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => mongoose.isValidObjectId(id)) : null;
  const filter = { user: req.user._id, read: false, ...(ids ? { _id: { $in: ids } } : {}) };
  await Notification.updateMany(filter, { read: true });
  const unread = await Notification.countDocuments({ user: req.user._id, read: false });
  res.status(200).json({ status: "success", data: { unread } });
});

exports.clearNotifications = catchAsync(async (req, res) => {
  await Notification.deleteMany({ user: req.user._id });
  res.status(200).json({ status: "success", message: "Notifications cleared." });
});

// ----------------------------------------------------------------------
// Web Push subscriptions

exports.getPushPublicKey = catchAsync(async (req, res) => {
  if (!isPushConfigured()) {
    throw new AppError("Push notifications are not configured on the server.", 503, "PUSH_NOT_CONFIGURED");
  }
  res.status(200).json({ status: "success", data: { publicKey: process.env.VAPID_PUBLIC_KEY } });
});

exports.subscribePush = catchAsync(async (req, res) => {
  const { endpoint, keys } = req.body?.subscription || {};
  if (
    typeof endpoint !== "string" ||
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 2048 ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    throw new AppError("A valid push subscription is required.", 400, "VALIDATION_ERROR");
  }
  // An endpoint belongs to one browser; re-assign it if another user signs in there.
  await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: req.user._id,
      platform: "web",
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: String(req.get("user-agent") || "").slice(0, 512),
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  res.status(200).json({ status: "success", message: "Push notifications enabled on this device." });
});

exports.unsubscribePush = catchAsync(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === "string") {
    await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  }
  res.status(200).json({ status: "success", message: "Push notifications disabled on this device." });
});
