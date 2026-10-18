"use strict";

const nodemailer = require("nodemailer");
const config = require("../config");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: config.mail.user, pass: config.mail.pass }
});

transporter.verify().then(
  () => console.log("[mail] SMTP connection OK"),
  err => console.warn("[mail] SMTP unavailable:", err.message)
);

const FROM = `"${config.mail.fromName}" <${config.mail.user}>`;

const LAYOUT = (title, inner) => `
<div style="background:#e8eef8;padding:32px 16px;font-family:Segoe UI,Roboto,Arial,sans-serif">
  <div style="max-width:480px;margin:auto;background:#f2f6fc;border-radius:22px;padding:32px 28px;
              box-shadow:8px 8px 20px rgba(122,146,184,.30),-8px -8px 20px rgba(255,255,255,.90)">
    <div style="font-size:20px;font-weight:700;color:#2b3a55;margin-bottom:4px">
      Unlock <span style="color:#0ea5b7">Flow</span>
    </div>
    <div style="height:3px;width:56px;background:linear-gradient(90deg,#22c1dc,#0ea5b7);border-radius:99px;margin-bottom:20px"></div>
    <h1 style="font-size:18px;color:#2b3a55;margin:0 0 12px">${title}</h1>
    ${inner}
    <p style="font-size:12px;color:#8296b3;margin-top:26px">
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>
</div>`;

async function sendMail({ to, subject, html, text }) {
  await transporter.sendMail({ from: FROM, to, subject, html, text });
}

async function sendVerificationCode(email, code) {
  await sendMail({
    to: email,
    subject: `${code} is your Unlock Flow code`,
    text: `Your Unlock Flow verification code is: ${code}\nIt expires in ${config.security.codeTtlMinutes} minutes.`,
    html: LAYOUT(
      "Verify your email",
      `<p style="font-size:14px;color:#55678a">Enter this code in the extension to finish signing up:</p>
       <div style="text-align:center;margin:22px 0">
         <span style="display:inline-block;font-size:30px;font-weight:800;letter-spacing:10px;
                      color:#0e7f8f;background:#e3f5f8;border-radius:16px;padding:14px 10px 14px 20px;
                      box-shadow:inset 3px 3px 8px rgba(14,127,143,.15),inset -3px -3px 8px rgba(255,255,255,.9)">
           ${code}
         </span>
       </div>
       <p style="font-size:13px;color:#8296b3">Valid for ${config.security.codeTtlMinutes} minutes.</p>`
    )
  });
}

async function sendApprovedEmail(email, paidThrough) {
  await sendMail({
    to: email,
    subject: "Payment approved — Unlock Flow",
    text: `Your payment was approved. Access is active until ${paidThrough.toISOString().slice(0, 10)}.`,
    html: LAYOUT(
      "Payment approved ✅",
      `<p style="font-size:14px;color:#55678a">Thanks! Your payment was verified and your access is now active until:</p>
       <p style="text-align:center;font-size:17px;font-weight:700;color:#0e7f8f;margin:18px 0">
         ${paidThrough.toDateString()}
       </p>
       <p style="font-size:14px;color:#55678a">Open the extension and tap Refresh if it still shows locked.</p>`
    )
  });
}

async function sendRejectedEmail(email, note) {
  await sendMail({
    to: email,
    subject: "Payment could not be verified — Unlock Flow",
    text: `Your receipt could not be verified.${note ? " Note: " + note : ""} Please submit a new receipt link.`,
    html: LAYOUT(
      "Payment not verified ⚠️",
      `<p style="font-size:14px;color:#55678a">Your receipt could not be verified.</p>
       ${note ? `<p style="font-size:13px;color:#b35252;background:#fbeeee;border-radius:12px;padding:10px 14px">Admin note: ${note}</p>` : ""}
       <p style="font-size:14px;color:#55678a">Open the extension → Account to submit a new receipt link.</p>`
    )
  });
}

module.exports = { sendVerificationCode, sendApprovedEmail, sendRejectedEmail };
