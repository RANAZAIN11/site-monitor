// Delivery: email is primary (free, reliable). WhatsApp is optional and only
// fires if Twilio env vars are present.
//
// The email body IS the full styled HTML report (built in report.js), and the
// same HTML is also attached as a standalone .html file so it can be opened
// directly in a browser if the email client mangles any styling.

import nodemailer from "nodemailer";

function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendEmail(siteName, plainTextSummary, htmlReport, overallIssues) {
  const transporter = makeTransport();

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

// Escalation email to the admin: "the report went out, but these previously
// flagged task(s) are STILL not done." Sent to ADMIN_EMAIL, separate from the
// main report that goes to MAIL_TO. `pending` = carried-over issues, each with
// { sev, title, url, problem, fix, ageDays }.
export async function sendAdminAlert(siteName, pending, meta = {}) {
  const to = process.env.ADMIN_EMAIL || "rz1753431@gmail.com";
  if (!to || !pending || pending.length === 0) return null;

  const dateStr = meta.dateStr || new Date().toLocaleDateString("en-GB");
  const MAX_ROWS = 60;
  const shown = pending.slice(0, MAX_ROWS);
  const more = pending.length - shown.length;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const subject = `\u{1F6A8} ${siteName}: ${pending.length} task(s) still NOT done \u2014 ${dateStr}`;

  const ageText = (d) =>
    d >= 1 ? `open ${d} day${d === 1 ? "" : "s"}` : "carried over from the last run";

  const rows = shown
    .map(
      (i) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top">
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${
            i.sev === "HIGH" ? "#dc2626" : i.sev === "MED" ? "#d97706" : "#6b7280"
          }">${esc(i.sev)}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;vertical-align:top">
          <a href="${esc(i.url)}" style="color:#111827;font-weight:600;text-decoration:none">${esc(
        i.title || i.label || "(item)"
      )}</a>
          <div style="color:#6b7280;font-size:12px;margin-top:2px">${esc(ageText(i.ageDays || 0))}</div>
          <div style="color:#374151;font-size:13px;margin-top:4px">${esc(i.problem || "")}</div>
          <div style="color:#166534;font-size:12.5px;margin-top:4px"><strong>Fix:</strong> ${esc(
            i.fix || ""
          )}</div>
        </td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:720px;margin:0 auto;padding:24px 16px">
      <div style="background:linear-gradient(135deg,#b91c1c,#dc2626);border-radius:16px;padding:22px;color:#fff;margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;opacity:.85">Admin escalation</div>
        <div style="font-size:22px;font-weight:800;margin-top:6px">${esc(siteName)} \u2014 pending tasks not done</div>
        <div style="font-size:13.5px;margin-top:4px;opacity:.9">${esc(dateStr)}</div>
      </div>
      <p style="font-size:14px;color:#374151;line-height:1.6">
        The daily monitor ran and the full report was sent to the team, but the
        <strong>${pending.length}</strong> item(s) below were already flagged in a previous run and are
        <strong>still not fixed</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        ${rows}
      </table>
      ${
        more > 0
          ? `<p style="font-size:13px;color:#6b7280;margin-top:12px">\u2026and ${more} more. See the full report email for everything.</p>`
          : ""
      }
    </div></body></html>`;

  const textLines = [
    `${siteName}: ${pending.length} previously-flagged task(s) still NOT done as of ${dateStr}.`,
    "",
    ...shown.map(
      (i, n) =>
        `${n + 1}. [${i.sev}] ${i.title || i.label} (${ageText(i.ageDays || 0)})\n   ${i.problem}\n   Fix: ${i.fix}\n   ${i.url}`
    ),
    more > 0 ? `\n...and ${more} more.` : "",
  ];

  const transporter = makeTransport();
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: textLines.join("\n"),
    html,
  });
  return { to, count: pending.length };
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
