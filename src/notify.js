// Delivery: email is primary (free, reliable). WhatsApp is optional and only
// fires if Twilio env vars are present.
//
// The email body IS the full styled HTML report (built in report.js), and the
// same HTML is also attached as a standalone .html file so it can be opened
// directly in a browser if the email client mangles any styling.

import nodemailer from "nodemailer";

export async function sendEmail(siteName, plainTextSummary, htmlReport, overallIssues) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const subject = `${overallIssues ? "\u26A0\uFE0F" : "\u2705"} ${siteName} morning check \u2014 ${new Date().toLocaleDateString(
    "en-GB"
  )}`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    subject,
    text: plainTextSummary, // plain-text fallback for clients that can't render HTML
    html: htmlReport,
    attachments: [
      {
        filename: `${siteName.replace(/\s+/g, "_")}_report_${new Date().toISOString().slice(0, 10)}.html`,
        content: htmlReport,
        contentType: "text/html",
      },
    ],
  });

  return subject;
}

export async function sendWhatsApp(plainTextSummary) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.WHATSAPP_TO) return null;
  const { default: twilio } = await import("twilio");
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const body =
    plainTextSummary.length > 1500 ? plainTextSummary.slice(0, 1490) + "\u2026" : plainTextSummary;
  const res = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: process.env.WHATSAPP_TO,
    body,
  });
  return res.sid;
}
