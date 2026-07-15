// Delivery: email is primary (free, reliable). WhatsApp is optional and only
// fires if Twilio env vars are present.

import nodemailer from "nodemailer";

export async function sendEmail(siteName, summary, results) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const attachments = results
    .filter((r) => r.screenshotB64)
    .map((r) => ({
      filename: `${r.label.replace(/\s+/g, "_")}.png`,
      content: Buffer.from(r.screenshotB64, "base64"),
    }));

  const hasIssues = /ISSUES FOUND|SCRIPT ERROR/i.test(summary);
  const subject = `${hasIssues ? "\u26A0\uFE0F" : "\u2705"} ${siteName} morning check \u2014 ${new Date().toLocaleDateString("en-GB")}`;

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    subject,
    text: summary,
    html:
      `<pre style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;white-space:pre-wrap;margin:0">${escapeHtml(
        summary
      )}</pre>` +
      `<p style="color:#888;font-size:12px;margin-top:16px">Automated ${escapeHtml(
        siteName
      )} front-end check. Full-page screenshots attached.</p>`,
    attachments,
  });

  return subject;
}

export async function sendWhatsApp(summary) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.WHATSAPP_TO) return null;
  const { default: twilio } = await import("twilio");
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const body = summary.length > 1500 ? summary.slice(0, 1490) + "\u2026" : summary;
  const res = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: process.env.WHATSAPP_TO,
    body,
  });
  return res.sid;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
