"use strict";

// Socket.IO handlers for direct conversations and groups: listing, history,
// sending, message actions (star, react, delete, forward, report), per-user
// chat state (pin, archive, mute, read, clear) and group management.
//
// Every handler derives the acting user from the authenticated socket and
// re-checks membership against the database. Events are delivered to each
// user's personal room (the user id), so all of a user's devices stay in sync.

const mongoose = require("mongoose");
const User = require("../models/user");
const OneToOneMessage = require("../models/OneToOneMessage");
const Group = require("../models/group");
const Report = require("../models/report");
const { notify, pushMessage } = require("./notificationService");
const { allowedTypes, createDownloadUrl, isUserChatKey, verifyUploadedObject } = require("./objectStorage");

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const PARTICIPANT_FIELDS = "firstName lastName avatar status about lastSeen";
const MAX_FORWARD_TARGETS = 10;

const isId = (value) => mongoose.isValidObjectId(value);
const idStr = (value) => String(value?._id ?? value);
const includesId = (list = [], id) => list.some((item) => idStr(item) === String(id));
const userTime = (list = [], userId) => list.find((entry) => idStr(entry.user) === String(userId))?.at;
const chatTypeOf = (value) => (value === "group" ? "group" : "direct");

class ChatError extends Error {}

// Notification text for a message.
function pushPreview(message) {
  const mime = message.mimeType || "";
  const label = mime.startsWith("video/")
    ? "🎥 Video"
    : mime.startsWith("audio/")
      ? "🎵 Audio"
      : mime.startsWith("image/") || message.type === "Media"
        ? "📷 Photo"
        : message.file
          ? `📎 ${message.fileName || "Document"}`
          : "";
  if (message.forwarded && !label) return `Forwarded: ${message.text}`.slice(0, 200);
  return (label ? `${label}${message.text ? ` ${message.text}` : ""}` : message.text || "").slice(0, 200);
}

function membersOf(chat) {
  return (chat.members ?? chat.participants).map(idStr);
}

async function loadChat(chatType, chatId, userId) {
  if (!isId(chatId)) return null;
  return chatType === "group"
    ? Group.findOne({ _id: chatId, members: userId })
    : OneToOneMessage.findOne({ _id: chatId, participants: userId });
}

function isVisible(message, userId, clearedAt) {
  if (includesId(message.deletedFor, userId)) return false;
  if (clearedAt && message.created_at <= clearedAt) return false;
  return true;
}

async function signedUrl(key) {
  try {
    return await createDownloadUrl(key);
  } catch (error) {
    console.error("Unable to sign attachment URL:", error.message);
    return undefined;
  }
}

// The client-facing shape of a message for one viewer.
async function serializeMessage(message, viewerId, { withUrl = true } = {}) {
  const m = typeof message.toObject === "function" ? message.toObject() : message;
  const deleted = Boolean(m.deletedForEveryone);
  const out = {
    _id: m._id,
    from: m.from,
    to: m.to,
    type: m.type,
    created_at: m.created_at,
    text: deleted ? "" : m.text || "",
    file: deleted ? undefined : m.file,
    mimeType: deleted ? undefined : m.mimeType,
    fileSize: deleted ? undefined : m.fileSize,
    fileName: deleted ? undefined : m.fileName,
    replyTo: !deleted && m.replyTo?.messageId ? m.replyTo : undefined,
    forwarded: Boolean(m.forwarded),
    reactions: deleted ? [] : (m.reactions || []).map((r) => ({ user: r.user, emoji: r.emoji })),
    starred: includesId(m.starredBy, viewerId),
    deleted,
  };
  if (out.file && withUrl) out.fileUrl = await signedUrl(out.file);
  return out;
}

// The conversation-list entry for one viewer.
async function summarize(chat, chatType, viewerId) {
  const clearedAt = userTime(chat.clearedAt, viewerId);
  const lastRead = userTime(chat.lastRead, viewerId);
  const visible = chat.messages.filter((m) => isVisible(m, viewerId, clearedAt));
  const last = visible.at(-1);
  const summary = {
    _id: chat._id,
    chat_type: chatType,
    lastMessage: last ? await serializeMessage(last, viewerId, { withUrl: false }) : null,
    unread: visible.filter(
      (m) => idStr(m.from) !== String(viewerId) && (!lastRead || m.created_at > lastRead)
    ).length,
    pinned: includesId(chat.pinnedBy, viewerId),
    archived: includesId(chat.archivedBy, viewerId),
    muted: includesId(chat.mutedBy, viewerId),
    // "Deleted" chats stay hidden until a new message arrives.
    hidden: Boolean(clearedAt) && !last,
  };
  if (chatType === "group") {
    return {
      ...summary,
      name: chat.name,
      about: chat.about,
      createdBy: idStr(chat.createdBy),
      admins: chat.admins.map(idStr),
      members: chat.members,
      createdAt: chat.createdAt,
    };
  }
  return { ...summary, participants: chat.participants };
}

async function populateChat(chat, chatType) {
  return chat.populate(chatType === "group" ? "members" : "participants", PARTICIPANT_FIELDS);
}

// Throws ChatError when either side of a direct chat has blocked the other.
async function assertNotBlocked(userId, otherId) {
  const [me, other] = await Promise.all([
    User.findById(userId).select("blocked"),
    User.findById(otherId).select("blocked"),
  ]);
  if (!other) throw new ChatError("User not found");
  if (includesId(me?.blocked, otherId)) throw new ChatError("Unblock this contact to send messages.");
  if (includesId(other.blocked, userId)) throw new ChatError("You can't send messages to this user.");
}

function installChatHandlers(socket, io, userId) {
  const emitTo = (userIds, event, payload) =>
    userIds.forEach((id) => io.to(String(id)).emit(event, payload));

  // Emit a payload built separately for each recipient.
  const emitEach = async (userIds, event, build) => {
    await Promise.all(
      userIds.map(async (id) => io.to(String(id)).emit(event, await build(String(id))))
    );
  };

  // Wrap a handler: validate the callback and turn errors into { error }.
  const on = (event, handler) => {
    socket.on(event, async (data = {}, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};
      try {
        await handler(data || {}, reply);
      } catch (error) {
        if (error instanceof ChatError) return reply({ error: error.message });
        console.error(`Error handling ${event}:`, error);
        reply({ error: "Something went wrong. Please try again." });
      }
    });
  };

  // Core append used by sending and forwarding.
  async function appendMessage(chatType, chat, fields) {
    if (chatType === "direct") {
      const other = membersOf(chat).find((id) => id !== String(userId));
      await assertNotBlocked(userId, other);
      fields.to = other;
    }
    chat.messages.push({ ...fields, from: userId, created_at: new Date() });
    // Sending implies the sender has read the chat.
    chat.lastRead = (chat.lastRead || []).filter((e) => idStr(e.user) !== String(userId));
    chat.lastRead.push({ user: userId, at: new Date() });
    await chat.save();

    const saved = chat.messages[chat.messages.length - 1];
    const sender = await User.findById(userId).select("firstName lastName");
    const message = await serializeMessage(saved, userId);
    message.starred = false;
    emitTo(membersOf(chat), "new_message", {
      chat_type: chatType,
      conversation_id: String(chat._id),
      group_name: chatType === "group" ? chat.name : undefined,
      sender: { _id: String(userId), firstName: sender?.firstName, lastName: sender?.lastName },
      message,
    });
    // Push to members who don't have the app open.
    pushMessage({
      recipients: membersOf(chat).filter((id) => id !== String(userId)),
      chat,
      chatType,
      sender,
      preview: pushPreview(saved),
    }).catch((error) => console.error("Message push failed:", error));
    return saved;
  }

  // --------------------------------------------------------------- typing

  // Relay "typing" to the other members. Membership is checked once per chat
  // and cached on the socket, since typing events are frequent.
  const typingAllowed = new Map();
  socket.on("typing", async (data = {}) => {
    try {
      const chatType = chatTypeOf(data.chat_type);
      const key = `${chatType}:${data.chat_id}`;
      const cached = typingAllowed.get(key);
      // Re-check membership every minute so group changes are picked up.
      if (!cached || Date.now() - cached.at > 60_000) {
        const chat = isId(data.chat_id)
          ? await (chatType === "group"
              ? Group.findOne({ _id: data.chat_id, members: userId }).select("members")
              : OneToOneMessage.findOne({ _id: data.chat_id, participants: userId }).select("participants"))
          : null;
        typingAllowed.set(key, { at: Date.now(), others: chat ? membersOf(chat).filter((id) => id !== String(userId)) : null });
      }
      const { others } = typingAllowed.get(key);
      if (!others) return;
      emitTo(others, "typing", {
        chat_type: chatType,
        chat_id: String(data.chat_id),
        user_id: String(userId),
        typing: Boolean(data.typing),
      });
    } catch (error) {
      console.error("Error relaying typing:", error);
    }
  });

  // ---------------------------------------------------------------- lists

  on("get_direct_conversations", async (_data, reply) => {
    const me = await User.findById(userId).select("blocked");
    const chats = await OneToOneMessage.find({ participants: userId }).populate(
      "participants",
      PARTICIPANT_FIELDS
    );
    const otherIds = chats.flatMap((c) => membersOf(c)).filter((id) => id !== String(userId));
    const blockedMe = new Set(
      (await User.find({ _id: { $in: otherIds }, blocked: userId }).select("_id")).map(idStr)
    );
    const list = await Promise.all(
      chats.map(async (chat) => {
        const summary = await summarize(chat, "direct", userId);
        const other = membersOf(chat).find((id) => id !== String(userId));
        return { ...summary, blockedByMe: includesId(me?.blocked, other), blockedMe: blockedMe.has(other) };
      })
    );
    reply(list);
  });

  on("get_groups", async (_data, reply) => {
    const groups = await Group.find({ members: userId }).populate("members", PARTICIPANT_FIELDS);
    reply(await Promise.all(groups.map((g) => summarize(g, "group", userId))));
  });

  on("start_conversation", async (data, reply) => {
    const { to } = data;
    if (!isId(to) || String(to) === String(userId)) throw new ChatError("Invalid user");
    let chat = await OneToOneMessage.findOne({ participants: { $size: 2, $all: [to, userId] } });
    if (!chat) chat = await OneToOneMessage.create({ participants: [to, userId] });
    // Opening a deleted/archived chat brings it back for this user.
    await OneToOneMessage.updateOne({ _id: chat._id }, { $pull: { archivedBy: userId } });
    chat = await populateChat(await OneToOneMessage.findById(chat._id), "direct");
    const summary = { ...(await summarize(chat, "direct", userId)), hidden: false };
    socket.emit("start_chat", summary);
    reply({ success: true, conversation: summary });
  });

  // -------------------------------------------------------------- history

  on("get_messages", async (data, reply) => {
    const chatType = chatTypeOf(data.chat_type);
    const chat = await loadChat(chatType, data.chat_id || data.conversation_id, userId);
    if (!chat) throw new ChatError("Conversation not found");
    const clearedAt = userTime(chat.clearedAt, userId);
    const visible = chat.messages.filter((m) => isVisible(m, userId, clearedAt));
    reply(await Promise.all(visible.map((m) => serializeMessage(m, userId))));
  });

  // -------------------------------------------------------------- sending

  async function send(data, kind, reply) {
    const chatType = chatTypeOf(data.chat_type);
    const chat = await loadChat(chatType, data.chat_id || data.conversation_id, userId);
    if (!chat) throw new ChatError("Conversation not found");

    const fields = {};
    if (kind === "text") {
      if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 10000) {
        throw new ChatError("Message must contain 1 to 10000 characters");
      }
      fields.type = "Text";
      fields.text = data.message.trim();
    } else {
      if (!isUserChatKey(data.file, userId)) {
        throw new ChatError("Invalid attachment");
      }
      const mimeType = String(data.contentType || "");
      if (!allowedTypes.has(mimeType)) throw new ChatError("Unsupported attachment type");
      try {
        await verifyUploadedObject(data.file, String(userId));
      } catch (error) {
        throw new ChatError(error.isOperational ? error.message : "The attachment could not be verified. Please try again.");
      }
      // Photos and videos show in the media gallery; everything else is a document.
      fields.type = /^(image|video)\//.test(mimeType) ? "Media" : "Document";
      fields.file = data.file;
      fields.mimeType = mimeType;
      if (Number.isInteger(data.fileSize) && data.fileSize > 0) fields.fileSize = data.fileSize;
      fields.fileName = String(data.fileName || "").slice(0, 255) || undefined;
      // Caption for photos/videos; documents show their file name.
      fields.text = String(data.message || "").slice(0, 1000);
    }

    if (data.reply_to && isId(data.reply_to)) {
      const original = chat.messages.id(data.reply_to);
      if (original && isVisible(original, userId, userTime(chat.clearedAt, userId))) {
        fields.replyTo = {
          messageId: original._id,
          from: original.from,
          type: original.type,
          text: original.deletedForEveryone
            ? "This message was deleted"
            : (
                original.text ||
                (original.mimeType?.startsWith("video/")
                  ? "🎥 Video"
                  : original.mimeType?.startsWith("image/")
                    ? "📷 Photo"
                    : original.mimeType?.startsWith("audio/")
                      ? "🎵 Audio"
                      : original.fileName || (original.file ? "Attachment" : ""))
              ).slice(0, 300),
        };
      }
    }

    await appendMessage(chatType, chat, fields);
    reply({ success: true });
  }

  on("text_message", (data, reply) => send(data, "text", reply));
  on("file_message", (data, reply) => send(data, "file", reply));

  // ------------------------------------------------------ message actions

  on("message_action", async (data, reply) => {
    const chatType = chatTypeOf(data.chat_type);
    const chat = await loadChat(chatType, data.chat_id, userId);
    if (!chat) throw new ChatError("Conversation not found");
    const message = isId(data.message_id) ? chat.messages.id(data.message_id) : null;
    if (!message || !isVisible(message, userId, userTime(chat.clearedAt, userId))) {
      throw new ChatError("Message not found");
    }
    const ref = { chat_type: chatType, chat_id: String(chat._id), message_id: String(message._id) };

    switch (data.action) {
      case "star":
      case "unstar": {
        message.starredBy = message.starredBy.filter((id) => idStr(id) !== String(userId));
        if (data.action === "star") message.starredBy.push(userId);
        await chat.save();
        emitTo([userId], "message_updated", { ...ref, message: await serializeMessage(message, userId) });
        break;
      }
      case "react": {
        if (message.deletedForEveryone) throw new ChatError("Message was deleted");
        if (!REACTIONS.includes(data.emoji)) throw new ChatError("Unsupported reaction");
        const mine = message.reactions.find((r) => idStr(r.user) === String(userId));
        if (mine && mine.emoji === data.emoji) {
          message.reactions = message.reactions.filter((r) => r !== mine);
        } else if (mine) {
          mine.emoji = data.emoji;
        } else {
          message.reactions.push({ user: userId, emoji: data.emoji });
        }
        await chat.save();
        await emitEach(membersOf(chat), "message_updated", async (id) => ({
          ...ref,
          message: await serializeMessage(message, id),
        }));
        break;
      }
      case "delete_me": {
        message.deletedFor.push(userId);
        await chat.save();
        emitTo([userId], "message_removed", ref);
        break;
      }
      case "delete_all": {
        if (idStr(message.from) !== String(userId)) {
          throw new ChatError("You can only delete your own messages for everyone");
        }
        message.deletedForEveryone = true;
        message.text = "";
        message.file = undefined;
        message.reactions = [];
        await chat.save();
        await emitEach(membersOf(chat), "message_updated", async (id) => ({
          ...ref,
          message: await serializeMessage(message, id),
        }));
        break;
      }
      default:
        throw new ChatError("Unknown action");
    }
    reply({ success: true });
  });

  on("forward_message", async (data, reply) => {
    const sourceType = chatTypeOf(data.chat_type);
    const source = await loadChat(sourceType, data.chat_id, userId);
    const original = source && isId(data.message_id) ? source.messages.id(data.message_id) : null;
    if (!original || original.deletedForEveryone || !isVisible(original, userId, userTime(source.clearedAt, userId))) {
      throw new ChatError("Message not found");
    }
    const targets = Array.isArray(data.targets) ? data.targets.slice(0, MAX_FORWARD_TARGETS) : [];
    if (!targets.length) throw new ChatError("Choose at least one chat");

    const me = await User.findById(userId).select("friends");
    const results = [];
    for (const target of targets) {
      try {
        const targetType = chatTypeOf(target.chat_type);
        let chat;
        if (targetType === "direct" && target.user_id) {
          if (!includesId(me.friends, target.user_id)) throw new ChatError("You can only forward to friends");
          chat =
            (await OneToOneMessage.findOne({ participants: { $size: 2, $all: [target.user_id, userId] } })) ||
            (await OneToOneMessage.create({ participants: [target.user_id, userId] }));
        } else {
          chat = await loadChat(targetType, target.chat_id, userId);
        }
        if (!chat) throw new ChatError("Conversation not found");
        await appendMessage(targetType, chat, {
          type: original.type,
          text: original.text,
          file: original.file,
          mimeType: original.mimeType,
          fileSize: original.fileSize,
          fileName: original.fileName,
          forwarded: true,
        });
        results.push({ ok: true });
      } catch (error) {
        results.push({ ok: false, error: error instanceof ChatError ? error.message : "Failed" });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    if (!sent) throw new ChatError(results[0]?.error || "Unable to forward");
    reply({ success: true, sent, failed: results.length - sent });
  });

  on("report_message", async (data, reply) => {
    const chatType = chatTypeOf(data.chat_type);
    const chat = await loadChat(chatType, data.chat_id, userId);
    const message = chat && isId(data.message_id) ? chat.messages.id(data.message_id) : null;
    if (!message) throw new ChatError("Message not found");
    if (idStr(message.from) === String(userId)) throw new ChatError("You can't report your own message");
    try {
      await Report.create({
        reporter: userId,
        chatType,
        chatId: chat._id,
        messageId: message._id,
        reportedUser: message.from,
        text: message.text,
        file: message.file,
        reason: typeof data.reason === "string" ? data.reason.slice(0, 500) : undefined,
      });
    } catch (error) {
      if (error.code === 11000) throw new ChatError("You already reported this message");
      throw error;
    }
    reply({ success: true, message: "Thanks, the message was reported." });
  });

  // ----------------------------------------------------------- chat state

  const STATE_ACTIONS = {
    pin: ["pinnedBy", true],
    unpin: ["pinnedBy", false],
    archive: ["archivedBy", true],
    unarchive: ["archivedBy", false],
    mute: ["mutedBy", true],
    unmute: ["mutedBy", false],
  };

  on("chat_action", async (data, reply) => {
    const chatType = chatTypeOf(data.chat_type);
    const chat = await loadChat(chatType, data.chat_id, userId);
    if (!chat) throw new ChatError("Conversation not found");
    const Model = chatType === "group" ? Group : OneToOneMessage;

    if (STATE_ACTIONS[data.action]) {
      const [field, add] = STATE_ACTIONS[data.action];
      await Model.updateOne({ _id: chat._id }, add ? { $addToSet: { [field]: userId } } : { $pull: { [field]: userId } });
    } else if (data.action === "mark_read" || data.action === "clear") {
      const field = data.action === "mark_read" ? "lastRead" : "clearedAt";
      await Model.updateOne({ _id: chat._id }, { $pull: { [field]: { user: userId } } });
      await Model.updateOne({ _id: chat._id }, { $push: { [field]: { user: userId, at: new Date() } } });
      if (data.action === "clear") {
        await Model.updateOne({ _id: chat._id }, { $pull: { pinnedBy: userId } });
      }
    } else {
      throw new ChatError("Unknown action");
    }

    const fresh = await populateChat(await Model.findById(chat._id), chatType);
    const summary = await summarize(fresh, chatType, userId);
    // Keep the user's other devices in sync.
    emitTo([userId], "chat_updated", summary);
    reply({ success: true, conversation: summary });
  });

  // --------------------------------------------------------------- groups

  async function broadcastGroup(group, extraRemoved = []) {
    const populated = await populateChat(await Group.findById(group._id), "group");
    if (!populated) return;
    await emitEach(membersOf(populated), "group_updated", (id) => summarize(populated, "group", id));
    emitTo(extraRemoved, "group_removed", { chat_type: "group", chat_id: String(group._id) });
  }

  async function notifyGroupAdded(group, userIds) {
    if (!userIds.length) return;
    const actor = await User.findById(userId).select("firstName lastName");
    userIds.forEach((id) =>
      notify({
        userId: id,
        type: "group_added",
        actorId: userId,
        title: `Added to ${group.name}`,
        body: `${actor.firstName} ${actor.lastName} added you to the group "${group.name}".`,
        data: { chat_type: "group", chat_id: String(group._id) },
        url: "/group",
      })
    );
  }

  async function friendsOnly(memberIds) {
    const me = await User.findById(userId).select("friends blocked");
    const unique = [...new Set((memberIds || []).map(String))].filter((id) => isId(id) && id !== String(userId));
    const invalid = unique.filter((id) => !includesId(me.friends, id) || includesId(me.blocked, id));
    if (invalid.length) throw new ChatError("You can only add your friends");
    return unique;
  }

  on("create_group", async (data, reply) => {
    const name = typeof data.name === "string" ? data.name.trim() : "";
    if (!name || name.length > 80) throw new ChatError("Group name must be 1 to 80 characters");
    const members = await friendsOnly(data.members);
    if (!members.length) throw new ChatError("Add at least one friend");
    const group = await Group.create({
      name,
      about: typeof data.about === "string" ? data.about.trim().slice(0, 500) : undefined,
      createdBy: userId,
      admins: [userId],
      members: [userId, ...members],
    });
    await broadcastGroup(group);
    notifyGroupAdded(group, members);
    const populated = await populateChat(group, "group");
    reply({ success: true, group: await summarize(populated, "group", userId) });
  });

  on("update_group", async (data, reply) => {
    const group = await loadChat("group", data.group_id, userId);
    if (!group) throw new ChatError("Group not found");
    const isAdmin = includesId(group.admins, userId);
    const requireAdmin = () => {
      if (!isAdmin) throw new ChatError("Only group admins can do that");
    };
    const removed = [];

    switch (data.action) {
      case "rename": {
        requireAdmin();
        const name = typeof data.name === "string" ? data.name.trim() : "";
        if (!name || name.length > 80) throw new ChatError("Group name must be 1 to 80 characters");
        group.name = name;
        if (typeof data.about === "string") group.about = data.about.trim().slice(0, 500);
        break;
      }
      case "add_members": {
        requireAdmin();
        const members = await friendsOnly(data.members);
        const added = members.filter((id) => !includesId(group.members, id));
        for (const id of added) group.members.push(id);
        notifyGroupAdded(group, added);
        break;
      }
      case "remove_member": {
        requireAdmin();
        if (!isId(data.user_id) || String(data.user_id) === String(userId)) throw new ChatError("Invalid member");
        group.members = group.members.filter((id) => idStr(id) !== String(data.user_id));
        group.admins = group.admins.filter((id) => idStr(id) !== String(data.user_id));
        removed.push(String(data.user_id));
        break;
      }
      case "make_admin": {
        requireAdmin();
        if (!includesId(group.members, data.user_id)) throw new ChatError("Invalid member");
        if (!includesId(group.admins, data.user_id)) group.admins.push(data.user_id);
        break;
      }
      case "leave": {
        group.members = group.members.filter((id) => idStr(id) !== String(userId));
        group.admins = group.admins.filter((id) => idStr(id) !== String(userId));
        removed.push(String(userId));
        if (!group.members.length) {
          await Group.deleteOne({ _id: group._id });
          emitTo(removed, "group_removed", { chat_type: "group", chat_id: String(group._id) });
          return reply({ success: true });
        }
        if (!group.admins.length) group.admins.push(group.members[0]);
        break;
      }
      default:
        throw new ChatError("Unknown action");
    }

    await group.save();
    await broadcastGroup(group, removed);
    reply({ success: true });
  });
}

module.exports = { installChatHandlers, serializeMessage, summarize, REACTIONS };
