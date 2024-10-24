const sgMail = require("@sendgrid/mail");
const nodemailer = require('nodemailer');
sgMail.setApiKey(process.env.SG_KEY);

const sendSGMail = async ({
  to,
  sender,
  subject,
  html,
  attachments,
  text,
}) => {
  try {
    const from = sender || "a2fsharma@gmail.com";

    const msg = {
      to: to, // Change to your recipient
      from: from, // Change to your verified sender
      subject: subject,
      html: html,
      // text: text,
      attachments,
    };


    return sgMail.send(msg);
  } catch (error) {
    console.log(error);
  }
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'a2fsharma@gmail.com',  // Replace with your email
    pass: 'rszi hekr vorq bfyj'     // Replace with your email password
  }
});
// rszi hekr vorq bfyj
const sendNodemailerMail = async ({
  to,
  sender,
  subject,
  html,
  attachments,
  text,
}) => {
  try {
    const from = sender || "a2fsharma@gmail.com";

    const mailOptions = {
      to: to, 
      from: from,
      subject: subject,
      html: html,
      // text: text,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
  } catch (error) {
    console.error('Error sending email:', error);
  }
};

exports.sendEmail = async (args) => {
  if (!process.env.NODE_ENV === "development") {
    return Promise.resolve();
  } else {
    // return sendSGMail(args);
    return sendNodemailerMail(args);
  }
};