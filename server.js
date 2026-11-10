const path = require("path");
const dotenv = require("dotenv");
const nodeEnv = process.env.NODE_ENV || "development";
dotenv.config({
  path: [
    path.resolve(__dirname, `.env.${nodeEnv}`),
    path.resolve(__dirname, ".env"),
  ],
});

const mongoose = require("mongoose");
const { verifyAccessToken, AuthTokenError } = require("./services/tokenService");
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const os = require("os");
process.on("uncaughtException", (err) => {
  console.log(err);
  console.log("UNCAUGHT Exception! Shutting down ...");
  process.exit(1); // Exit Code 1 indicates that a container shut down, either because of an application failure.
});

const io = new Server(server, {
  cors: {
    origin: (process.env.CORS_ORIGINS || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim()),
    methods: ["GET", "PATCH", "POST", "DELETE", "PUT"],
  },
});

const User = require("./models/user");
const FriendRequest = require("./models/friendRequest");
const AudioCall = require("./models/audioCall");
const VideoCall = require("./models/videoCall");
const { getCallProvider } = require("./services/callProvider");
const { installChatHandlers } = require("./services/chatService");
const { isUserOnline, markOnline, markOffline, resetPresence, userSocketCount } = require("./services/presenceService");
const { createAdapter } = require("@socket.io/redis-adapter");
const { closeRedis, getRedis, getRedisSubscriber, keyPrefix, redisEnabled } = require("./services/redis");
const { initNotifications, notify } = require("./services/notificationService");
const { checkStorageConfig } = require("./services/objectStorage");
const {
  installMediasoupSocketHandlers,
  closeCallRoom,
} = require("./services/mediasoupServer");

function getCallModel(mediaType) {
  return mediaType === "audio" ? AudioCall : VideoCall;
}

async function findCall(mediaType, roomId) {
  if (!mongoose.isValidObjectId(roomId)) return null;
  return getCallModel(mediaType).findById(roomId);
}

// Several API instances share Socket.IO rooms and events through Redis.
if (redisEnabled()) {
  io.adapter(createAdapter(getRedis(), getRedisSubscriber(), { key: `${keyPrefix}socket.io` }));
}

app.set("io", io);
initNotifications(io);

// Socket authentication uses the same short-lived access token as the REST API.
// The error message is a machine-readable code: on TOKEN_EXPIRED the client
// refreshes its access token and reconnects.
io.use(async (socket, next) => {
  try {
    const { userId, tokenVersion } = verifyAccessToken(socket.handshake.auth?.token);
    const user = await User.findById(userId).select("_id verified tokenVersion");
    if (!user || !user.verified || (user.tokenVersion ?? 0) !== tokenVersion) {
      return next(new Error("TOKEN_INVALID"));
    }
    socket.userId = user._id.toString();
    // Visible to other instances through fetchSockets() (presence checks).
    socket.data.userId = socket.userId;
    next();
  } catch (error) {
    next(new Error(error instanceof AuthTokenError ? error.code : "TOKEN_INVALID"));
  }
});

const databaseUrl =
  process.env.DATABASE ||
  (nodeEnv === "development"
    ? "mongodb://localhost:27017/chatapp_development"
    : "");
if (!databaseUrl) {
  throw new Error("DATABASE must be configured outside development");
}
mongoose
  .connect(databaseUrl)
  .then(() => {
    console.log(`MongoDB connected (${nodeEnv})`);
    resetPresence(io).catch((error) => console.error("Error resetting presence:", error));
    checkStorageConfig().then(({ ok, reason }) => {
      if (!ok) console.warn(`${red}File uploads are disabled: ${reason}.${reset}`);
    });
    server.listen(PORT, () => {
      console.log(`Local:   ${lightBlue}http://localhost:${PORT}/${reset}`);
      console.log(`Network: ${lightBlue}http://${HOST}:${PORT}/${reset}`);
      if (nodeEnv === "development") {
        console.log(
          `Swagger: ${lightBlue}http://localhost:${PORT}/api-docs/${reset}`,
        );
        console.log(
          `Note:    ${red}You cannot see Swagger interface on Network.${reset}\n`,
        );
      }
    });
  })
  .catch((error) => {
    console.error(`${red}MongoDB connection failed (${nodeEnv}).${reset}`);
    console.error(describeMongoError(error));
    if (nodeEnv === "development") console.error(error);
    process.exit(1);
  });

// Turn common MongoDB startup failures into an actionable message.
// Never print the connection string: it contains the database password.
function describeMongoError(error) {
  const envFile = `.env.${nodeEnv}`;
  if (error?.code === 8000 || error?.code === 18 || /auth/i.test(error?.message)) {
    return [
      "Authentication failed: the username or password in DATABASE was rejected.",
      `  - Check DATABASE in ${envFile} (or .env).`,
      "  - In Atlas: Database Access -> edit the user -> reset the password.",
      "  - URL-encode special characters in the password (e.g. @ -> %40, : -> %3A).",
    ].join("\n");
  }
  if (error?.name === "MongooseServerSelectionError" || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|querySrv/i.test(error?.message)) {
    return [
      "Could not reach the database server.",
      "  - Atlas: Network Access -> allow your current IP address.",
      "  - Local: make sure mongod is running on the host/port in DATABASE.",
    ].join("\n");
  }
  return `Unexpected error: ${error?.message}`;
}

// Connect to MongoDB Online
// const dbUrl = process.env.DATABASE.replace(
//     "<PASSWORD>",
//     process.env.DATABASE_PASSWORD
// );
// mongoose.connect(dbUrl,
//     {
//         useNewUrlParser: true, // The underlying MongoDB driver has deprecated their current connection string parser. Because this is a major change, they added the useNewUrlParser flag to allow users to fall back to the old parser if they find a bug in the new parser.
//         useUnifiedTopology: true, // Set to true to opt in to using the MongoDB driver's new connection management engine. You should set this option to true , except for the unlikely case that it prevents you from maintaining a stable connection.
//     }).then((conn) => {
//         console.log('\nMongoDB Connection successful.\nHost:',conn.connections[0].host,'\nDatabase Port:',conn.connections[0].port,'\nDatabase Name:',conn.connections[0].name,'\n');
//     })
//     .catch(err => console.error('\nMongoDB connection error: ', err,'\n'));

function getLocalIp() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Skip over non-IPv4 and internal (localhost) addresses
      if (net.family === "IPv4" && !net.internal) {
        return net.address; // Return the local IP address
      }
    }
  }

  return "localhost"; // Fallback to localhost if no network interface is found
}

const HOST = getLocalIp();
const PORT = process.env.PORT || 8000;

const lightBlue = "\x1b[36m"; // Light blue text
const red = "\x1b[31m"; // Red text
const reset = "\x1b[0m"; // Reset to default color

io.on("connection", async (socket) => {
  try {
    const user_id = socket.userId;

    console.log(`User connected ${socket.id}`);

    // Join the room and register listeners synchronously: awaiting the DB write
    // first dropped any event the client sent right after connecting.
    socket.join(user_id);
    // First device to connect makes the user Online and tells their contacts.
    userSocketCount(io, user_id)
      .then((count) => count === 1 && markOnline(io, user_id, socket.id))
      .catch((error) => console.error("Error updating presence:", error));
    installMediasoupSocketHandlers(
      socket,
      io,
      async (roomId, participantId) => {
        const call =
          (await AudioCall.findById(roomId)) ||
          (await VideoCall.findById(roomId));
        return Boolean(
          call &&
            call.provider === "MEDIASOUP" &&
            call.status === "Ongoing" &&
            call.participants.some(
              (participant) => String(participant) === participantId
            )
        );
      }
    );

    // We can write our socket event listeners in here...
    socket.on("friend_request", async (data, callback) => {
      try {
        const to = data?.to;
        if (!mongoose.isValidObjectId(to) || String(to) === user_id) {
          return callback?.({ error: "Invalid recipient" });
        }
        const [me, recipient] = await Promise.all([
          User.findById(user_id).select("friends blocked"),
          User.findOne({ _id: to, verified: true }).select("_id blocked"),
        ]);
        if (!me || !recipient) {
          return callback?.({ error: "User not found" });
        }
        const blocked = (list, id) => (list || []).some((x) => String(x) === String(id));
        if (blocked(me.blocked, to) || blocked(recipient.blocked, user_id)) {
          return callback?.({ error: "Unable to send a request to this user" });
        }
        if (me.friends.some((id) => String(id) === String(to))) {
          return callback?.({ error: "You are already friends" });
        }
        const existing = await FriendRequest.findOne({
          $or: [
            { sender: user_id, recipient: to },
            { sender: to, recipient: user_id },
          ],
        });
        if (existing) {
          return callback?.({
            error:
              String(existing.sender) === user_id
                ? "Request already sent"
                : "This user already sent you a request. Check your Requests tab.",
          });
        }

        const request = await FriendRequest.create({ sender: user_id, recipient: to });
        const sender = await User.findById(user_id).select("firstName lastName");
        notify({
          userId: to,
          type: "friend_request",
          actorId: user_id,
          title: "New friend request",
          body: `${sender.firstName} ${sender.lastName} wants to be your friend.`,
          data: { request_id: String(request._id) },
        });

        io.to(String(to)).emit("new_friend_request", {
          message: "New friend request received",
        });
        callback?.({ success: true, message: "Friend request sent" });
      } catch (error) {
        console.error("Error handling friend request:", error);
        callback?.({ error: "Unable to send the request" });
      }
    });

    socket.on("accept_request", async (data, callback) => {
      try {
        if (!mongoose.isValidObjectId(data?.request_id)) {
          return callback?.({ error: "Invalid request" });
        }
        // Only the recipient may accept; delete first so a double click
        // cannot accept twice.
        const request_doc = await FriendRequest.findOneAndDelete({
          _id: data.request_id,
          recipient: user_id,
        });
        if (!request_doc) {
          return callback?.({ error: "Request not found" });
        }
        const sender = String(request_doc.sender);
        await Promise.all([
          User.updateOne({ _id: sender }, { $addToSet: { friends: user_id } }),
          User.updateOne({ _id: user_id }, { $addToSet: { friends: sender } }),
        ]);

        const payload = { message: "Friend request accepted" };
        const accepter = await User.findById(user_id).select("firstName lastName");
        notify({
          userId: sender,
          type: "request_accepted",
          actorId: user_id,
          title: "Friend request accepted",
          body: `${accepter.firstName} ${accepter.lastName} accepted your friend request.`,
          data: { user_id },
        });
        io.to(sender).emit("request_accepted", payload);
        io.to(user_id).emit("request_accepted", payload);
        callback?.({ success: true, message: "Friend request accepted" });
      } catch (error) {
        console.error("Error accepting friend request:", error);
        callback?.({ error: "Unable to accept the request" });
      }
    });

    socket.on("decline_request", async (data, callback) => {
      try {
        if (!mongoose.isValidObjectId(data?.request_id)) {
          return callback?.({ error: "Invalid request" });
        }
        const request_doc = await FriendRequest.findOneAndDelete({
          _id: data.request_id,
          recipient: user_id,
        });
        if (!request_doc) {
          return callback?.({ error: "Request not found" });
        }
        io.to(user_id).emit("request_declined", { message: "Friend request declined" });
        callback?.({ success: true, message: "Friend request declined" });
      } catch (error) {
        console.error("Error declining friend request:", error);
        callback?.({ error: "Unable to decline the request" });
      }
    });

    // Direct chats, groups and message actions.
    installChatHandlers(socket, io, user_id);

    for (const mediaType of ["audio", "video"]) {
      const model = getCallModel(mediaType);
      const eventPrefix = `${mediaType}_call`;

      socket.on(`start_${eventPrefix}`, async (data = {}) => {
        try {
          const call = await findCall(mediaType, data.callId || data.roomID);
          if (
            !call ||
            call.status !== "Ongoing" ||
            String(call.from) !== user_id
          ) {
            return socket.emit("call:error", { message: "Call is no longer available." });
          }
          const caller = await User.findById(user_id).select(
            "firstName lastName avatar"
          );
          // Nobody to ring: end the call now instead of ringing for 30 seconds.
          if (!(await isUserOnline(io, call.to))) {
            await model.findByIdAndUpdate(call._id, {
              verdict: "Missed",
              status: "Ended",
              endedAt: Date.now(),
            });
            closeCallRoom(String(call._id));
            const callee = await User.findById(call.to).select("firstName");
            notify({
              userId: call.to,
              type: "missed_call",
              actorId: user_id,
              title: `Missed ${mediaType} call`,
              body: `${caller.firstName} ${caller.lastName} tried to call you.`,
              data: { call_id: String(call._id), media: mediaType, user_id },
              pushKind: "calls",
              url: "/call",
            });
            return socket.emit(`${eventPrefix}_unavailable`, {
              callId: String(call._id),
              message: `${callee?.firstName || "This contact"} is offline. Try again later.`,
            });
          }
          io.to(String(call.to)).emit(`${eventPrefix}_notification`, {
            callId: String(call._id),
            roomID: String(call._id),
            provider: call.provider || getCallProvider(),
            userID: String(call.to),
            peerID: user_id,
            from_user: caller,
            userName: `${caller.firstName} ${caller.lastName}`.trim(),
          });
        } catch (error) {
          console.error(`Error starting ${mediaType} call:`, error);
          socket.emit("call:error", { message: "Unable to start call." });
        }
      });

      socket.on(`${eventPrefix}_accepted`, async (data = {}) => {
        try {
          const call = await findCall(mediaType, data.callId || data.roomID);
          if (
            !call ||
            call.status !== "Ongoing" ||
            String(call.to) !== user_id
          ) {
            return;
          }
          await model.findByIdAndUpdate(call._id, { verdict: "Accepted" });
          io.to(String(call.from)).emit(`${eventPrefix}_accepted`, {
            callId: String(call._id),
            roomID: String(call._id),
          });
        } catch (error) {
          console.error(`Error accepting ${mediaType} call:`, error);
        }
      });

      socket.on(`${eventPrefix}_denied`, async (data = {}) => {
        try {
          const call = await findCall(mediaType, data.callId || data.roomID);
          if (
            !call ||
            call.status !== "Ongoing" ||
            String(call.to) !== user_id
          ) {
            return;
          }
          await model.findByIdAndUpdate(call._id, {
            verdict: "Denied",
            status: "Ended",
            endedAt: Date.now(),
          });
          io.to(String(call.from)).emit(`${eventPrefix}_denied`, {
            callId: String(call._id),
            roomID: String(call._id),
          });
          closeCallRoom(String(call._id));
        } catch (error) {
          console.error(`Error denying ${mediaType} call:`, error);
        }
      });

      socket.on(`${eventPrefix}_not_picked`, async (data = {}) => {
        try {
          const call = await findCall(mediaType, data.callId || data.roomID);
          if (
            !call ||
            call.status !== "Ongoing" ||
            String(call.from) !== user_id
          ) {
            return;
          }
          await model.findByIdAndUpdate(call._id, {
            verdict: "Missed",
            status: "Ended",
            endedAt: Date.now(),
          });
          io.to(String(call.to)).emit(`${eventPrefix}_missed`, {
            callId: String(call._id),
            roomID: String(call._id),
          });
          const missedCaller = await User.findById(user_id).select("firstName lastName");
          notify({
            userId: call.to,
            type: "missed_call",
            actorId: user_id,
            title: `Missed ${mediaType} call`,
            body: `${missedCaller.firstName} ${missedCaller.lastName} tried to call you.`,
            data: { call_id: String(call._id), media: mediaType, user_id },
            pushKind: "calls",
            url: "/call",
          });
          closeCallRoom(String(call._id));
        } catch (error) {
          console.error(`Error marking ${mediaType} call missed:`, error);
        }
      });

      socket.on(`user_is_busy_${eventPrefix}`, async (data = {}) => {
        try {
          const roomId = data.call?.callId || data.call?.roomID || data.callId || data.roomID;
          const call = await findCall(mediaType, roomId);
          if (
            !call ||
            call.status !== "Ongoing" ||
            String(call.to) !== user_id
          ) {
            return;
          }
          await model.findByIdAndUpdate(call._id, {
            verdict: "Busy",
            status: "Ended",
            endedAt: Date.now(),
          });
          io.to(String(call.from)).emit(`${eventPrefix}_denied`, {
            callId: String(call._id),
            roomID: String(call._id),
            reason: "busy",
          });
          closeCallRoom(String(call._id));
        } catch (error) {
          console.error(`Error marking ${mediaType} call busy:`, error);
        }
      });

      socket.on(`${eventPrefix}_ended`, async (data = {}) => {
        try {
          const call = await findCall(mediaType, data.callId || data.roomID);
          if (
            !call ||
            call.status !== "Ongoing" ||
            !call.participants.some((participant) => String(participant) === user_id)
          ) {
            return;
          }
          await model.findByIdAndUpdate(call._id, {
            status: "Ended",
            endedAt: Date.now(),
          });
          const otherParticipant =
            String(call.from) === user_id ? call.to : call.from;
          io.to(String(otherParticipant)).emit(`${eventPrefix}_ended`, {
            callId: String(call._id),
            roomID: String(call._id),
          });
          closeCallRoom(String(call._id));
        } catch (error) {
          console.error(`Error ending ${mediaType} call:`, error);
        }
      });
    }

    socket.on("end", async (data) => {
      try {
        console.log("closing connection");
        socket.disconnect(0);
      } catch (error) {
        console.error("Error ending session:", error);
      }
    });

    socket.on("disconnect", async () => {
      // Stay Online while another tab/device of this user (on any instance) is connected.
      try {
        if (await isUserOnline(io, user_id)) return;
        await markOffline(io, user_id);
      } catch (error) {
        console.error("Error updating presence:", error);
      }
    });
  } catch (err) {
    console.log("Error in connection:", err);
  }
});

process.on("unhandledRejection", (err) => {
  console.log(err);
  console.log("UNHANDLED REJECTION! Shutting down ...");
  server.close(() => {
    process.exit(1); //  Exit Code 1 indicates that a container shut down, either because of an application failure.
  });
});

// Graceful shutdown (containers send SIGTERM): stop accepting work, close
// connections, then exit.
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down…");
  io.close();
  server.close(async () => {
    await Promise.allSettled([mongoose.connection.close(), closeRedis()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
});
