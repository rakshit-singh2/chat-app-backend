"use strict";

// Notifications: the in-app notification centre (stored + live over Socket.IO)
// and Web Push to devices when the user has no open tab/app connection.

const webPush = require("web-push");
const User = require("../models/user");
const Notification = require("../models/notification");
const PushSubscription = require("../models/pushSubscription");

let io = null;
let pushConfigured = false;

function initNotifications(socketServer) {
  io = socketServer;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webPush.setVapidDetails(VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      pushConfigured = true;
    } catch (error) {
      console.warn(`Push notifications are disabled: ${error.message}`);
    }
  } else {
    console.warn("Push notifications are disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set.");
  }
}

const isPushConfigured = () => pushConfigured;
const isConnected = async (userId) => {
  if (!io) return false;
  try {
    return (await io.in(String(userId)).fetchSockets()).length > 0;
  } catch {
    return Boolean(io.sockets.adapter.rooms.get(String(userId))?.size);
  }
};

const DEFAULT_PREFS = { messages: true, groups: true, calls: true, activity: true, preview: true };

// Send a push to every device of a user, unless they're connected (then the
// open app shows its own alert) or have that kind of notification turned off.
// kind: "messages" | "groups" | "calls" | "activity"
async function pushToUser(userId, payload, kind, { force = false } = {}) {
  if (!pushConfigured || (!force && (await isConnected(userId)))) return;
  const user = await User.findById(userId).select("settings");
  const prefs = { ...DEFAULT_PREFS, ...(user?.settings?.notifications?.toObject?.() || user?.settings?.notifications || {}) };
  if (prefs[kind] === false) return;

  const subscriptions = await PushSubscription.find({ user: userId, platform: "web" });
  if (!subscriptions.length) return;
  const message = JSON.stringify({
    ...payload,
    body: prefs.preview || payload.alwaysShowBody ? payload.body : "New notification",
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          message,
          { TTL: 24 * 3600, urgency: kind === "calls" ? "high" : "normal" }
        );
        await PushSubscription.updateOne({ _id: sub._id }, { lastUsedAt: new Date() });
      } catch (error) {
        // 404/410: the browser dropped this subscription.
        if (error.statusCode === 404 || error.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error("Push delivery failed:", error.statusCode || error.message);
        }
      }
    })
  );
}

const ACTOR_FIELDS = "firstName lastName avatar";

async function serialize(doc) {
  const populated = doc.actor?.firstName ? doc : await doc.populate("actor", ACTOR_FIELDS);
  return {
    _id: String(populated._id),
    type: populated.type,
    title: populated.title,
    body: populated.body,
    data: populated.data || {},
    read: populated.read,
    createdAt: populated.createdAt,
    actor: populated.actor
      ? {
          _id: String(populated.actor._id),
          firstName: populated.actor.firstName,
          lastName: populated.actor.lastName,
          avatar: populated.actor.avatar,
        }
      : null,
  };
}

// Store a notification-centre entry, deliver it live and push it.
async function notify({ userId, type, actorId, title, body, data = {}, pushKind = "activity", url = "/app" }) {
  try {
    const doc = await Notification.create({ user: userId, type, actor: actorId, title, body, data });
    const item = await serialize(doc);
    io?.to(String(userId)).emit("notification", item);
    await pushToUser(userId, { title, body, tag: `${type}:${String(doc._id)}`, data: { url, notificationId: item._id, type, ...data } }, pushKind);
    return item;
  } catch (error) {
    console.error("Unable to create notification:", error);
    return null;
  }
}

// Push for a new chat message to recipients without an open connection.
async function pushMessage({ recipients, chat, chatType, sender, preview }) {
  const name = `${sender?.firstName || ""} ${sender?.lastName || ""}`.trim() || "New message";
  const muted = new Set((chat.mutedBy || []).map(String));
  await Promise.all(
    recipients
      .filter((id) => !muted.has(String(id)))
      .map((id) =>
        pushToUser(
          id,
          {
            title: chatType === "group" ? `${name} @ ${chat.name}` : name,
            body: preview,
            // One notification per chat, replaced by newer messages.
            tag: `${chatType}:${String(chat._id)}`,
            renotify: true,
            data: { url: chatType === "group" ? "/group" : "/app", chat_type: chatType, chat_id: String(chat._id) },
          },
          chatType === "group" ? "groups" : "messages"
        ).catch((error) => console.error("Message push failed:", error))
      )
  );
}

async function listNotifications(userId, { limit = 50 } = {}) {
  const docs = await Notification.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .populate("actor", ACTOR_FIELDS);
  const items = await Promise.all(docs.map(serialize));
  const unread = await Notification.countDocuments({ user: userId, read: false });
  return { items, unread };
}

module.exports = {
  initNotifications,
  isPushConfigured,
  listNotifications,
  notify,
  pushMessage,
  pushToUser,
};
