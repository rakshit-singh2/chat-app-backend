"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AudioCall = require("../models/audioCall");
const VideoCall = require("../models/videoCall");
const {
  getCallProvider,
  getCallProviderInfo,
  createCallCredentials,
} = require("./callProvider");

function withEnvironment(values, run) {
  const original = {};
  for (const key of Object.keys(values)) {
    original[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  const restore = () => {
    for (const key of Object.keys(values)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  };
  try {
    const result = run();
    if (result && typeof result.then === "function") {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("selects the configured provider case-insensitively", () => {
  withEnvironment({ STREAMING_SERVICE: "agora" }, () => {
    assert.equal(getCallProvider(), "AGORA");
  });
});

test("defaults to Agora when no provider is configured", () => {
  withEnvironment({ STREAMING_SERVICE: undefined }, () => {
    assert.equal(getCallProvider(), "AGORA");
  });
});

test("call records default to the supported Agora provider", () => {
  for (const CallModel of [AudioCall, VideoCall]) {
    const provider = CallModel.schema.path("provider");
    assert.equal(provider.defaultValue, "AGORA");
    assert.deepEqual(provider.enumValues, ["AGORA", "MEDIASOUP"]);
  }
});

test("rejects unsupported providers", () => {
  withEnvironment({ STREAMING_SERVICE: "OTHER" }, () => {
    assert.throws(() => getCallProvider(), /STREAMING_SERVICE must be one of/);
  });
});

test("validates and returns configured ICE servers for mediasoup", () => {
  withEnvironment(
    {
      STREAMING_SERVICE: "MEDIASOUP",
      CALL_ICE_SERVERS: '[{"urls":"turn:turn.example.test","username":"user","credential":"secret"}]',
    },
    () => {
      assert.deepEqual(getCallProviderInfo(), {
        provider: "MEDIASOUP",
        iceServers: [
          {
            urls: "turn:turn.example.test",
            username: "user",
            credential: "secret",
          },
        ],
      });
    }
  );
});

test("rejects malformed ICE server configuration", () => {
  withEnvironment(
    { STREAMING_SERVICE: "MEDIASOUP", CALL_ICE_SERVERS: "not-json" },
    () => assert.throws(() => getCallProviderInfo(), /CALL_ICE_SERVERS/)
  );
});

test("issues an Agora token scoped to the call channel and participant account", async () => {
  const credentials = await withEnvironment(
    {
      STREAMING_SERVICE: "AGORA",
      AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
      AGORA_APP_CERTIFICATE: "abcdef0123456789abcdef0123456789",
    },
    () =>
      createCallCredentials({
        provider: "AGORA",
        roomId: "call-room",
        userId: "user-123",
        userName: "Test User",
      })
  );

  assert.equal(credentials.provider, "AGORA");
  assert.equal(credentials.appId, "0123456789abcdef0123456789abcdef");
  assert.ok(credentials.token.length > 0);
});

test("rejects incomplete Agora credentials", async () => {
  await withEnvironment(
    {
      STREAMING_SERVICE: "AGORA",
      AGORA_APP_ID: "not-an-app-id",
      AGORA_APP_CERTIFICATE: "short",
    },
    async () => {
      await assert.rejects(
        createCallCredentials({
          provider: "AGORA",
          roomId: "call-room",
          userId: "user-123",
          userName: "Test User",
        }),
        /Agora call credentials are not configured/
      );
    }
  );
});

test("refuses credentials for a provider no longer active", async () => {
  await withEnvironment(
    { STREAMING_SERVICE: "AGORA" },
    async () => {
      await assert.rejects(
        createCallCredentials({
          provider: "MEDIASOUP",
          roomId: "call-room",
          userId: "user-123",
          userName: "Test User",
        }),
        /provider changed/
      );
    }
  );
});
