const mongoose = require("mongoose");
const app = require("./app");
const http = require("http");
require('dotenv').config({ path: './config.env' });

const path = require("path")

const { Server } = require("socket.io");

const server = http.createServer(app);
const os = require('os');
process.on("uncaughtException", (err) => {
    console.log(err);
    console.log("UNCAUGHT Exception! Shutting down ...");
    process.exit(1); // Exit Code 1 indicates that a container shut down, either because of an application failure.
});

const { promisify } = require("util");

// Create an io server and allow for CORS from http://localhost:3000 with GET and POST methods
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "PATCH", "POST", "DELETE", "PUT"],
    },
});

const User = require("./models/user");
const FriendRequest = require("./models/friendRequest");
const OneToOneMessage = require("./models/OneToOneMessage");
const AudioCall = require("./models/audioCall");
const VideoCall = require("./models/videoCall");

// Connect to MongoDB Local
mongoose.connect('mongodb://localhost:27017/chatapp')
    .then(
        (conn) => {
            console.log('\nMongoDB Connection successful.\nHost:', conn.connections[0].host, '\nDatabase Port:', conn.connections[0].port, '\nDatabase Name:', conn.connections[0].name, '\n');
        }
    )
    .catch(err => console.error('\nMongoDB connection error: ', err, '\n'));

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
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;  // Return the local IP address
            }
        }
    }

    return 'localhost';  // Fallback to localhost if no network interface is found
}

const HOST = getLocalIp();
const PORT = process.env.PORT || 8000;

const lightBlue = '\x1b[36m'; // Light blue text
const red = '\x1b[31m'; // Red text
const reset = '\x1b[0m'; // Reset to default color

server.listen(PORT, () => {
    console.log(`Local:   ${lightBlue}http://localhost:${PORT}/${reset}`);
    console.log(`Network: ${lightBlue}http://${HOST}:${PORT}/${reset}`);
    console.log(`Swagger: ${lightBlue}http://localhost:${PORT}/api-docs/${reset}`);
    console.log(`Note:    ${red}You cannot see Swagger interface on Network.${reset}\n`);
}).on('error', (err) => {
    console.error('Error starting server:', err);
});

io.on("connection", async (socket) => {
    try {
        console.log(JSON.stringify(socket.handshake.query));
        const user_id = socket.handshake.query["user_id"];

        console.log(`User connected ${socket.id}`);

        if (user_id != null && Boolean(user_id)) {
            try {
                await User.findByIdAndUpdate(user_id, {
                    socket_id: socket.id,
                    status: "Online",
                });
            } catch (e) {
                console.log(e);
            }
        }

        // We can write our socket event listeners in here...
        socket.on("friend_request", async (data, callback) => {
            try {
                const toUser = await User.findById(data.to).select("socket_id");
                const fromUser = await User.findById(data.from).select("socket_id");

                if (!toUser || !fromUser) {
                    console.error("User not found:", data);
                    return callback({ error: "User not found" });
                }

                await FriendRequest.create({
                    sender: data.from,
                    recipient: data.to,
                });

                if (toUser.socket_id) {
                    io.to(toUser.socket_id).emit("new_friend_request", {
                        message: "New friend request received",
                    });
                }

                if (fromUser.socket_id) {
                    io.to(fromUser.socket_id).emit("request_sent", {
                        message: "Request Sent successfully!",
                    });
                }

                callback({ success: true });
            } catch (error) {
                console.error("Error handling friend request:", error);
                callback({ error: "An error occurred" });
            }
        });

        socket.on("accept_request", async (data) => {
            try {
                const request_doc = await FriendRequest.findById(data.request_id);
                const sender = await User.findById(request_doc.sender);
                const receiver = await User.findById(request_doc.recipient);

                sender.friends.push(request_doc.recipient);
                receiver.friends.push(request_doc.sender);

                await receiver.save({ new: true, validateModifiedOnly: true });
                await sender.save({ new: true, validateModifiedOnly: true });

                await FriendRequest.findByIdAndDelete(data.request_id);

                io.to(sender?.socket_id).emit("request_accepted", {
                    message: "Friend Request Accepted",
                });
                io.to(receiver?.socket_id).emit("request_accepted", {
                    message: "Friend Request Accepted",
                });
            } catch (error) {
                console.error("Error accepting friend request:", error);
            }
        });

        socket.on("get_direct_conversations", async ({ user_id }, callback) => {
            try {
                const existing_conversations = await OneToOneMessage.find({
                    participants: { $all: [user_id] },
                }).populate("participants", "firstName lastName avatar _id email status");

                callback(existing_conversations);
            } catch (error) {
                console.log("Error getting conversations:", error);
                callback({ error: "An error occurred while fetching conversations" });
            }
        });

        socket.on("start_conversation", async (data) => {
            try {
                const { to, from } = data;

                const existing_conversations = await OneToOneMessage.find({
                    participants: { $size: 2, $all: [to, from] },
                }).populate("participants", "firstName lastName _id email status");

                if (existing_conversations.length === 0) {
                    let new_chat = await OneToOneMessage.create({
                        participants: [to, from],
                    });

                    new_chat = await OneToOneMessage.findById(new_chat).populate(
                        "participants",
                        "firstName lastName _id email status"
                    );

                    socket.emit("start_chat", new_chat);
                } else {
                    socket.emit("start_chat", existing_conversations[0]);
                }
            } catch (error) {
                console.error("Error starting conversation:", error);
            }
        });

        socket.on("get_messages", async (data, callback) => {
            try {
                const { messages } = await OneToOneMessage.findById(
                    data.conversation_id
                ).select("messages");

                callback(messages);
            } catch (error) {
                console.log("Error getting messages:", error);
                callback({ error: "An error occurred while fetching messages" });
            }
        });

        socket.on("text_message", async (data) => {
            try {
                const { message, conversation_id, from, to, type } = data;

                const to_user = await User.findById(to);
                const from_user = await User.findById(from);

                const new_message = {
                    to: to,
                    from: from,
                    type: type,
                    created_at: Date.now(),
                    text: message,
                };

                const chat = await OneToOneMessage.findById(conversation_id);
                chat.messages.push(new_message);

                await chat.save({ new: true, validateModifiedOnly: true });

                io.to(to_user?.socket_id).emit("new_message", {
                    conversation_id,
                    message: new_message,
                });

                io.to(from_user?.socket_id).emit("new_message", {
                    conversation_id,
                    message: new_message,
                });
            } catch (error) {
                console.log("Error handling text message:", error);
            }
        });

        socket.on("file_message", async (data) => {
            try {
                console.log("Received message:", data);

                const fileExtension = path.extname(data.file.name);
                const filename = `${Date.now()}_${Math.floor(Math.random() * 10000)}${fileExtension}`;

                // File handling code here...

                // Save to db and emit message events
            } catch (error) {
                console.error("Error handling file message:", error);
            }
        });

        socket.on("start_audio_call", async (data) => {
            try {
                const { from, to, roomID } = data;

                const to_user = await User.findById(to);
                const from_user = await User.findById(from);

                io.to(to_user?.socket_id).emit("audio_call_notification", {
                    from: from_user,
                    roomID,
                    streamID: from,
                    userID: to,
                    userName: to,
                });
            } catch (error) {
                console.error("Error handling audio call start:", error);
            }
        });

        socket.on("audio_call_not_picked", async (data) => {
            try {
                const { to, from } = data;

                const to_user = await User.findById(to);

                await AudioCall.findOneAndUpdate(
                    { participants: { $size: 2, $all: [to, from] } },
                    { verdict: "Missed", status: "Ended", endedAt: Date.now() }
                );

                io.to(to_user?.socket_id).emit("audio_call_missed", {
                    from,
                    to,
                });
            } catch (error) {
                console.error("Error handling audio call not picked:", error);
            }
        });

        socket.on("audio_call_accepted", async (data) => {
            try {
                const { to, from } = data;

                const from_user = await User.findById(from);

                await AudioCall.findOneAndUpdate(
                    { participants: { $size: 2, $all: [to, from] } },
                    { verdict: "Accepted" }
                );

                io.to(from_user?.socket_id).emit("audio_call_accepted", {
                    from,
                    to,
                });
            } catch (error) {
                console.error("Error handling audio call accepted:", error);
            }
        });

        // Other audio/video call event handlers go here...

        socket.on("end", async (data) => {
            try {
                if (data.user_id) {
                    await User.findByIdAndUpdate(data.user_id, { status: "Offline" });
                }

                console.log("closing connection");
                socket.disconnect(0);
            } catch (error) {
                console.error("Error ending session:", error);
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
