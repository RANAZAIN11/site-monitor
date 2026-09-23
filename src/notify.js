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
  const hasPending = Array.isArray(pending) && pending.length > 0;
  const orders = meta.orders || null;
  // Send if there's EITHER unfinished work OR an orders summary to deliver.
  if (!to || (!hasPending && !orders)) return null;

  const dateStr = meta.dateStr || new Date().toLocaleDateString("en-GB");
  const MAX_ROWS = 60;
  const shown = hasPending ? pending.slice(0, MAX_ROWS) : [];
  const more = hasPending ? pending.length - shown.length : 0;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const nf = (n) => Number(n || 0).toLocaleString("en-US");

  const subject = hasPending
    ? `\u{1F6A8} ${siteName}: ${pending.length} task(s) still NOT done \u2014 ${dateStr}`
    : `\u{1F4E6} ${siteName}: daily orders summary \u2014 ${dateStr}`;

  const ageText = (d) =>
    d >= 1 ? `open ${d} day${d === 1 ? "" : "s"}` : "carried over from the last run";

  // ---- Orders summary (admin-only) ----
  const ordersSection = orders
    ? (() => {
        const row = (label, w) => `
          <tr>
            <td style="padding:9px 12px;border-bottom:1px solid #eee;font-size:13px;color:#374151">${label}</td>
            <td style="padding:9px 12px;border-bottom:1px solid #eee;font-size:13px;color:#111827;font-weight:700;text-align:right">${nf(
              w.total
            )}</td>
            <td style="padding:9px 12px;border-bottom:1px solid #eee;font-size:13px;font-weight:700;text-align:right;color:${
              w.cancelled > 0 ? "#dc2626" : "#6b7280"
            }">${nf(w.cancelled)}</td>
          </tr>`;
        return `
      <div style="font-size:13px;font-weight:800;color:#111827;margin:2px 0 8px">\u{1F4E6} Orders</div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:20px">
        <tr style="background:#f9fafb">
          <th style="padding:9px 12px;text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Period</th>
          <th style="padding:9px 12px;text-align:right;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Total orders</th>
          <th style="padding:9px 12px;text-align:right;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Cancelled</th>
        </tr>
        ${row("Yesterday", orders.yesterday)}
        ${row("Last 7 days", orders.last7)}
        ${row("This month", orders.month)}
      </table>`;
      })()
    : "";

  // ---- Pending tasks ----
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

  const pendingSection = hasPending
    ? `<div style="font-size:13px;font-weight:800;color:#111827;margin:2px 0 8px">\u26A0\uFE0F Still not done</div>
      <p style="font-size:13.5px;color:#374151;line-height:1.6;margin-top:0">
        The following <strong>${pending.length}</strong> item(s) were flagged in a previous run and are
        <strong>still not fixed</strong>.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        ${rows}
      </table>
      ${
        more > 0
          ? `<p style="font-size:13px;color:#6b7280;margin-top:12px">\u2026and ${more} more. See the full report email for everything.</p>`
          : ""
      }`
    : "";

  const heroBg = hasPending
    ? "linear-gradient(135deg,#b91c1c,#dc2626)"
    : "linear-gradient(135deg,#4338ca,#6366f1)";
  const heroKicker = hasPending ? "Admin escalation" : "Admin summary";
  const heroTitle = hasPending
    ? `${esc(siteName)} \u2014 pending tasks not done`
    : `${esc(siteName)} \u2014 daily orders summary`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:720px;margin:0 auto;padding:24px 16px">
      <div style="background:${heroBg};border-radius:16px;padding:22px;color:#fff;margin-bottom:18px">
        <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;opacity:.85">${heroKicker}</div>
        <div style="font-size:22px;font-weight:800;margin-top:6px">${heroTitle}</div>
        <div style="font-size:13.5px;margin-top:4px;opacity:.9">${esc(dateStr)} \u00B7 admin only</div>
      </div>
      ${ordersSection}
      ${pendingSection}
    </div></body></html>`;

  const textLines = [];
  if (orders) {
    const tl = (label, w) => `  ${label}: ${nf(w.total)} orders, ${nf(w.cancelled)} cancelled`;
    textLines.push(
      `${siteName} orders as of ${dateStr}:`,
      tl("Yesterday", orders.yesterday),
      tl("Last 7 days", orders.last7),
      tl("This month", orders.month),
      ""
    );
  }
  if (hasPending) {
    textLines.push(`${pending.length} previously-flagged task(s) still NOT done:`, "");
    shown.forEach((i, n) =>
      textLines.push(
        `${n + 1}. [${i.sev}] ${i.title || i.label} (${ageText(i.ageDays || 0)})\n   ${i.problem}\n   Fix: ${i.fix}\n   ${i.url}`
      )
    );
    if (more > 0) textLines.push(`\n...and ${more} more.`);
  }

  const transporter = makeTransport();
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: textLines.join("\n"),
    html,
  });
  return { to, count: hasPending ? pending.length : 0, orders: !!orders };
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
