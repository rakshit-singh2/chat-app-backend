"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const getMailerConfig = require("./mailerConfig");

const mailFrom = "verified@example.test";

test("requires a supported mail provider", () => {
  assert.throws(
    () => getMailerConfig({ MAIL_FROM: mailFrom }),
    /MAIL_PROVIDER must be one of/
  );
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "OTHER",
        MAIL_FROM: mailFrom,
      }),
    /MAIL_PROVIDER must be one of/
  );
});

test("selects Nodemailer without requiring a SendGrid key", () => {
  assert.deepEqual(
    getMailerConfig({
      MAIL_PROVIDER: "nodemailer",
      MAIL_FROM: mailFrom,
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer@gmail.test",
      SMTP_PASSWORD: "gmail-app-password",
    }),
    {
      provider: "NODEMAILER",
      from: mailFrom,
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "mailer@gmail.test",
      password: "gmail-app-password",
    }
  );
});

test("requires SMTP credentials only when Nodemailer is selected", () => {
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "NODEMAILER",
        MAIL_FROM: mailFrom,
        SG_KEY: "SG.test-key",
      }),
    /SMTP_HOST must be configured/
  );
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "NODEMAILER",
        MAIL_FROM: mailFrom,
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "not-a-port",
        SMTP_USER: "mailer@gmail.test",
        SMTP_PASSWORD: "gmail-app-password",
      }),
    /SMTP_PORT must be a valid port/
  );
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "NODEMAILER",
        MAIL_FROM: mailFrom,
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_USER: "mailer@gmail.test",
      }),
    /SMTP_USER and SMTP_PASSWORD must be configured/
  );
});

test("selects SendGrid without requiring SMTP settings", () => {
  assert.deepEqual(
    getMailerConfig({
      MAIL_PROVIDER: "SENDGRID",
      MAIL_FROM: mailFrom,
      SG_KEY: "SG.test-key",
    }),
    {
      provider: "SENDGRID",
      from: mailFrom,
      apiKey: "SG.test-key",
    }
  );
});

test("requires a SendGrid API key only when SendGrid is selected", () => {
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "SENDGRID",
        MAIL_FROM: mailFrom,
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_USER: "mailer@gmail.test",
        SMTP_PASSWORD: "gmail-app-password",
      }),
    /SG_KEY must be a valid SendGrid API key/
  );
});

test("requires a configured sender address", () => {
  assert.throws(
    () =>
      getMailerConfig({
        MAIL_PROVIDER: "NODEMAILER",
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_USER: "mailer@gmail.test",
        SMTP_PASSWORD: "gmail-app-password",
      }),
    /MAIL_FROM must be configured/
  );
});
