"use strict";

// Online / offline / last-seen presence, pushed live to everyone who can see
// the user: friends, direct-chat partners and fellow group members.

const User = require("../models/user");
const OneToOneMessage = require("../models/OneToOneMessage");
const Group = require("../models/group");

// Number of sockets a user has across all instances (Redis adapter) or this one.
async function userSocketCount(io, userId) {
  try {
    return (await io.in(String(userId)).fetchSockets()).length;
  } catch {
    // Adapter request timed out (e.g. an instance is down): use local knowledge.
    return io.sockets.adapter.rooms.get(String(userId))?.size || 0;
  }
}

const isUserOnline = async (io, userId) => (await userSocketCount(io, userId)) > 0;

async function contactsOf(userId) {
  const [me, chats, groups] = await Promise.all([
    User.findById(userId).select("friends"),
    OneToOneMessage.find({ participants: userId }).select("participants"),
    Group.find({ members: userId }).select("members"),
  ]);
  const ids = new Set([
    ...(me?.friends || []).map(String),
    ...chats.flatMap((c) => c.participants.map(String)),
    ...groups.flatMap((g) => g.members.map(String)),
  ]);
  ids.delete(String(userId));
  return [...ids];
}

async function broadcast(io, userId, payload) {
  const contacts = await contactsOf(userId);
  contacts.forEach((id) => io.to(id).emit("presence", { user_id: String(userId), ...payload }));
}

async function markOnline(io, userId, socketId) {
  await User.updateOne({ _id: userId }, { status: "Online", socket_id: socketId });
  await broadcast(io, userId, { online: true });
}

async function markOffline(io, userId) {
  const lastSeen = new Date();
  await User.updateOne({ _id: userId }, { status: "Offline", socket_id: null, lastSeen });
  await broadcast(io, userId, { online: false, lastSeen });
}

// On startup, clear "Online" flags left by a crash. With several instances,
// keep users who are connected to another instance (asked via the adapter).
async function resetPresence(io) {
  let connected = [];
  try {
    connected = (await io.fetchSockets()).map((s) => s.data?.userId).filter(Boolean);
  } catch {
    connected = [];
  }
  await User.updateMany(
    { status: "Online", _id: { $nin: [...new Set(connected)] } },
    { status: "Offline", socket_id: null, lastSeen: new Date() }
  );
}

module.exports = { contactsOf, isUserOnline, markOnline, markOffline, resetPresence, userSocketCount };
