"use strict";

// Optional Redis connection. Set REDIS_URL to enable it; without it the app
// runs as a single instance with in-memory state (fine for development).
//
// Used for:
//  - the Socket.IO adapter (events reach users connected to other instances)
//  - rate-limit counters shared by all instances
//  - cluster-wide presence (via the adapter's fetchSockets)

const { createClient } = require("redis");

const url = process.env.REDIS_URL || "";
const keyPrefix = process.env.REDIS_KEY_PREFIX || "chat-app:";

let client = null;
let subscriber = null;
let ready = null;

function createRedisClient() {
  const c = createClient({
    url,
    socket: {
      // Back off up to 5s between reconnect attempts; never give up.
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });
  c.on("error", (error) => console.error(`Redis error: ${error.message}`));
  return c;
}

if (url) {
  client = createRedisClient();
  subscriber = client.duplicate();
  subscriber.on("error", (error) => console.error(`Redis subscriber error: ${error.message}`));
  // Connect immediately so modules created at startup (rate limiters) can queue commands.
  ready = Promise.all([client.connect(), subscriber.connect()]).then(() => {
    console.log("Redis connected");
    return true;
  });
  ready.catch((error) => console.error(`Redis connection failed: ${error.message}`));
}

const redisEnabled = () => Boolean(client);
const getRedis = () => client;
const getRedisSubscriber = () => subscriber;
const waitForRedis = () => ready || Promise.resolve(false);

async function redisHealth() {
  if (!client) return "disabled";
  try {
    return (await client.ping()) === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

async function closeRedis() {
  await Promise.allSettled([client?.quit(), subscriber?.quit()]);
}

module.exports = {
  closeRedis,
  getRedis,
  getRedisSubscriber,
  keyPrefix,
  redisEnabled,
  redisHealth,
  waitForRedis,
};
