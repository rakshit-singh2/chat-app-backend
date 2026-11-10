"use strict";

const MAIL_PROVIDERS = ["NODEMAILER", "SENDGRID"];

function getMailerConfig(env = process.env) {
  const provider = env.MAIL_PROVIDER?.trim().toUpperCase();
  if (!MAIL_PROVIDERS.includes(provider)) {
    throw new Error(
      `MAIL_PROVIDER must be one of: ${MAIL_PROVIDERS.join(", ")}`
    );
  }

  const from = env.MAIL_FROM?.trim();
  if (!from) {
    throw new Error("MAIL_FROM must be configured.");
  }

  if (provider === "SENDGRID") {
    const apiKey = env.SG_KEY?.trim();
    if (!apiKey || !apiKey.startsWith("SG.")) {
      throw new Error("SG_KEY must be a valid SendGrid API key when MAIL_PROVIDER=SENDGRID.");
    }
    return { provider, from, apiKey };
  }

  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT);
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  const secure = env.SMTP_SECURE?.trim().toLowerCase() === "true";
  if (!host) {
    throw new Error("SMTP_HOST must be configured when MAIL_PROVIDER=NODEMAILER.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port when MAIL_PROVIDER=NODEMAILER.");
  }
  if (!user || !password) {
    throw new Error(
      "SMTP_USER and SMTP_PASSWORD must be configured when MAIL_PROVIDER=NODEMAILER."
    );
  }
  return { provider, from, host, port, secure, user, password };
}

module.exports = getMailerConfig;
