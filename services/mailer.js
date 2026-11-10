"use strict";

const nodemailer = require("nodemailer");
const getMailerConfig = require("./mailerConfig");

const config = getMailerConfig();
let sendWithProvider;

if (config.provider === "NODEMAILER") {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
  sendWithProvider = (message) => transporter.sendMail(message);
} else {
  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(config.apiKey);
  sendWithProvider = (message) => sgMail.send(message);
}

exports.sendEmail = ({ to, sender, subject, html, text, attachments }) =>
  sendWithProvider({
    to,
    from: sender || config.from,
    subject,
    html,
    ...(text ? { text } : {}),
    ...(attachments ? { attachments } : {}),
  });
