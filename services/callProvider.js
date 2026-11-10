"use strict";

const { RtcRole, RtcTokenBuilder } = require("agora-token");
const AppError = require("../utils/AppError");

const PROVIDERS = ["AGORA", "MEDIASOUP"];

function getCallProvider() {
  const provider = (process.env.STREAMING_SERVICE || "AGORA").trim().toUpperCase();
  if (!PROVIDERS.includes(provider)) {
    throw new Error(
      `STREAMING_SERVICE must be one of: ${PROVIDERS.join(", ")}`
    );
  }
  return provider;
}

function getIceServers() {
  let iceServers;
  try {
    iceServers = JSON.parse(process.env.CALL_ICE_SERVERS || "[]");
  } catch {
    throw new Error("CALL_ICE_SERVERS must be a JSON array");
  }
  if (
    !Array.isArray(iceServers) ||
    iceServers.some(
      (server) =>
        !server ||
        typeof server !== "object" ||
        !server.urls ||
        !(typeof server.urls === "string" || Array.isArray(server.urls))
    )
  ) {
    throw new Error("CALL_ICE_SERVERS must contain valid ICE server entries");
  }
  return iceServers;
}

function getCallProviderInfo() {
  const provider = getCallProvider();
  return {
    provider,
    iceServers: provider === "MEDIASOUP" ? getIceServers() : [],
  };
}

async function createCallCredentials({ provider, roomId, userId, userName }) {
  const activeProvider = provider || getCallProvider();
  if (activeProvider !== getCallProvider()) {
    throw new AppError("The call provider changed. Start a new call.", 409);
  }

  if (activeProvider === "AGORA") {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    if (
      typeof appId !== "string" ||
      !/^[a-f\d]{32}$/i.test(appId) ||
      typeof appCertificate !== "string" ||
      appCertificate.length !== 32
    ) {
      throw new AppError("Agora call credentials are not configured.", 503);
    }

    return {
      provider: activeProvider,
      roomId,
      userId,
      userName,
      token: RtcTokenBuilder.buildTokenWithUserAccount(
        appId,
        appCertificate,
        roomId,
        userId,
        RtcRole.PUBLISHER,
        3600,
        3600
      ),
      appId,
    };
  }

  return {
    provider: activeProvider,
    roomId,
    userId,
    userName,
    iceServers: getIceServers(),
  };
}

module.exports = {
  PROVIDERS,
  getCallProvider,
  getCallProviderInfo,
  createCallCredentials,
};
