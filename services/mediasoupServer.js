"use strict";

const mediasoup = require("mediasoup");
const AppError = require("../utils/AppError");

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
];

const rooms = new Map();
const socketSessions = new Map();
let worker;

async function initializeMediasoup() {
  if (worker) return;
  if (
    (process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0") === "0.0.0.0" &&
    !process.env.MEDIASOUP_ANNOUNCED_IP
  ) {
    throw new Error(
      "MEDIASOUP_ANNOUNCED_IP must be set when listening on 0.0.0.0"
    );
  }
  const minPort = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
  const maxPort = Number(process.env.MEDIASOUP_MAX_PORT || 49999);
  if (
    !Number.isInteger(minPort) ||
    !Number.isInteger(maxPort) ||
    minPort < 1 ||
    maxPort > 65535 ||
    minPort >= maxPort
  ) {
    throw new Error("Invalid mediasoup RTP port range");
  }

  worker = await mediasoup.createWorker({
    rtcMinPort: minPort,
    rtcMaxPort: maxPort,
  });
  worker.on("died", (error) => {
    console.error("mediasoup worker died:", error);
    process.exit(1);
  });
}

async function ensureRoom(roomId) {
  if (!worker) {
    await initializeMediasoup();
  }
  if (!rooms.has(roomId)) {
    const router = await worker.createRouter({ mediaCodecs });
    rooms.set(roomId, { router, producers: new Map(), sessions: new Set() });
  }
  return rooms.get(roomId);
}

async function prepareRoom(roomId) {
  await ensureRoom(roomId);
}

function getSession(socketId, roomId) {
  const session = socketSessions.get(socketId);
  if (!session || session.roomId !== roomId) {
    throw new AppError("Join this call before creating media transports.", 403);
  }
  return session;
}

function installMediasoupSocketHandlers(socket, io, authorizeCall) {
  const ack = (handler) => async (data = {}, response) => {
    try {
      const result = await handler(data);
      response?.({ data: result });
    } catch (error) {
      response?.({ error: error.message || "Media operation failed" });
    }
  };

  socket.on(
    "mediasoup:join",
    ack(async ({ roomId }) => {
      if (typeof roomId !== "string" || !(await authorizeCall(roomId, socket.userId))) {
        throw new AppError("You are not a participant in this call.", 403);
      }
      const room = await ensureRoom(roomId);
      const oldSession = socketSessions.get(socket.id);
      if (oldSession) closeSocketSession(socket.id);

      const session = {
        roomId,
        userId: socket.userId,
        router: room.router,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      };
      socketSessions.set(socket.id, session);
      room.sessions.add(socket.id);
      socket.join(`call:${roomId}`);
      return {
        routerRtpCapabilities: room.router.rtpCapabilities,
        producers: [...room.producers.values()].map(({ id, userId, kind }) => ({
          id,
          userId,
          kind,
        })),
      };
    })
  );

  socket.on(
    "mediasoup:create-transport",
    ack(async ({ roomId, direction }) => {
      if (!["send", "recv"].includes(direction)) {
        throw new AppError("Transport direction must be send or recv.", 400);
      }
      const session = getSession(socket.id, roomId);
      const transportOptions = {
        listenIps: [
          {
            ip: process.env.MEDIASOUP_LISTEN_IP || "0.0.0.0",
            ...(process.env.MEDIASOUP_ANNOUNCED_IP
              ? { announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP }
              : {}),
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1_000_000,
      };
      const transport = await session.router.createWebRtcTransport(transportOptions);
      session.transports.set(transport.id, { transport, direction });
      transport.on("dtlsstatechange", (state) => {
        if (state === "closed") transport.close();
      });
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    })
  );

  socket.on(
    "mediasoup:connect-transport",
    ack(async ({ roomId, transportId, dtlsParameters }) => {
      const entry = getSession(socket.id, roomId).transports.get(transportId);
      if (!entry) throw new AppError("Transport not found.", 404);
      const { transport } = entry;
      await transport.connect({ dtlsParameters });
      return { connected: true };
    })
  );

  socket.on(
    "mediasoup:produce",
    ack(async ({ roomId, transportId, kind, rtpParameters }) => {
      const session = getSession(socket.id, roomId);
      const entry = session.transports.get(transportId);
      if (!entry || entry.direction !== "send" || !["audio", "video"].includes(kind)) {
        throw new AppError("Invalid media transport or kind.", 400);
      }
      const { transport } = entry;
      const producer = await transport.produce({ kind, rtpParameters });
      const room = rooms.get(roomId);
      room.producers.set(producer.id, {
        id: producer.id,
        userId: socket.userId,
        kind,
        producer,
      });
      session.producers.set(producer.id, producer);
      producer.on("transportclose", () => {
        room.producers.delete(producer.id);
        session.producers.delete(producer.id);
      });
      socket.to(`call:${roomId}`).emit("mediasoup:new-producer", {
        id: producer.id,
        userId: socket.userId,
        kind,
      });
      return { id: producer.id };
    })
  );

  socket.on(
    "mediasoup:consume",
    ack(async ({ roomId, producerId, rtpCapabilities, transportId }) => {
      const session = getSession(socket.id, roomId);
      const entry = session.transports.get(transportId);
      const producerInfo = rooms.get(roomId).producers.get(producerId);
      if (
        !entry ||
        entry.direction !== "recv" ||
        !producerInfo ||
        producerInfo.userId === socket.userId ||
        !session.router.canConsume({ producerId, rtpCapabilities })
      ) {
        throw new AppError("This media stream cannot be consumed.", 400);
      }
      const { transport } = entry;
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });
      session.consumers.set(consumer.id, consumer);
      consumer.on("transportclose", () => session.consumers.delete(consumer.id));
      consumer.on("producerclose", () => {
        session.consumers.delete(consumer.id);
        socket.emit("mediasoup:producer-closed", { producerId });
      });
      return {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    })
  );

  socket.on(
    "mediasoup:resume-consumer",
    ack(async ({ roomId, consumerId }) => {
      const consumer = getSession(socket.id, roomId).consumers.get(consumerId);
      if (!consumer) throw new AppError("Consumer not found.", 404);
      await consumer.resume();
      return { resumed: true };
    })
  );

  socket.on("mediasoup:leave", () => closeSocketSession(socket.id));
  socket.on("disconnect", () => closeSocketSession(socket.id));
}

function closeSocketSession(socketId) {
  const session = socketSessions.get(socketId);
  if (!session) return;
  socketSessions.delete(socketId);
  const room = rooms.get(session.roomId);
  room?.sessions.delete(socketId);
  for (const consumer of session.consumers.values()) consumer.close();
  for (const producer of session.producers.values()) producer.close();
  for (const { transport } of session.transports.values()) transport.close();
  if (room) {
    for (const [producerId, producer] of room.producers) {
      if (producer.userId === session.userId) room.producers.delete(producerId);
    }
  }
}

function closeCallRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const socketId of room.sessions) closeSocketSession(socketId);
  room.router.close();
  rooms.delete(roomId);
}

module.exports = {
  initializeMediasoup,
  prepareRoom,
  installMediasoupSocketHandlers,
  closeCallRoom,
};
