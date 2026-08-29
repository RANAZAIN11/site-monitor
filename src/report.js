// Builds ONE self-contained, professional-looking HTML report (inline CSS +
// a small <style> block for interactive bits, screenshots embedded as base64
// — no external files/links needed). This same HTML string is used as the
// email body AND attached as a standalone .html file.

const CATEGORY_META = {
  price: { label: "Price Issues", icon: "\u{1F4B0}", color: "#f59e0b" },
  compare_at: { label: "Compare-at Price Issues", icon: "\u{1F3F7}\uFE0F", color: "#ec4899" },
  stock: { label: "Stock Issues", icon: "\u{1F4E6}", color: "#ef4444" },
  description: { label: "Description Issues", icon: "\u{1F4DD}", color: "#8b5cf6" },
  images: { label: "Missing Images", icon: "\u{1F5BC}\uFE0F", color: "#0ea5e9" },
  duplicate: { label: "Duplicate Products", icon: "\u{1F501}", color: "#f97316" },
  handle_mismatch: { label: "URL / Handle Mismatch", icon: "\u{1F517}", color: "#6366f1" },
  test_title: { label: "Test / Junk Products", icon: "\u{1F9EA}", color: "#64748b" },
};
const CATEGORY_ORDER = [
  "price",
  "compare_at",
  "stock",
  "description",
  "images",
  "duplicate",
  "handle_mismatch",
  "test_title",
];

const SEV_COLORS = {
  HIGH: { bg: "#fef2f2", border: "#dc2626", text: "#991b1b", badgeBg: "#dc2626" },
  MED: { bg: "#fffbeb", border: "#d97706", text: "#92400e", badgeBg: "#d97706" },
  LOW: { bg: "#eff6ff", border: "#2563eb", text: "#1e40af", badgeBg: "#2563eb" },
};

const SECTION_THEME = {
  website: { grad: "linear-gradient(135deg,#1d4ed8,#3b82f6)", tint: "#eff6ff", accent: "#1d4ed8" },
  seo: { grad: "linear-gradient(135deg,#7c3aed,#a855f7)", tint: "#faf5ff", accent: "#7c3aed" },
  catalogue: { grad: "linear-gradient(135deg,#047857,#10b981)", tint: "#ecfdf5", accent: "#047857" },
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sevBadge(sev) {
  const c = SEV_COLORS[sev] || SEV_COLORS.LOW;
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.03em;color:#fff;background:${c.badgeBg}">${esc(
    sev
  )}</span>`;
}

function issueCard(issue) {
  const c = SEV_COLORS[issue.sev] || SEV_COLORS.LOW;
  const titleLine = issue.title
    ? `<a href="${esc(issue.url)}" target="_blank" style="color:#111827;text-decoration:none;font-weight:600">${esc(
        issue.title
      )}</a>`
    : `<a href="${esc(issue.url)}" target="_blank" style="color:#111827;text-decoration:none;font-weight:600">${esc(
        issue.label
      )}</a>`;
  return `
  <div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:8px;padding:13px 15px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap">
      ${sevBadge(issue.sev)}
      ${titleLine}
    </div>
    <div style="font-size:13.5px;color:#374151;margin-bottom:5px;line-height:1.5">${esc(issue.problem)}</div>
    <div style="font-size:13px;color:${c.text};line-height:1.5"><strong>Fix:</strong> ${esc(issue.fix)}</div>
  </div>`;
}

function statPill(label, value, tone) {
  const bg = tone === "bad" ? "#fee2e2" : tone === "good" ? "#dcfce7" : "#f3f4f6";
  const fg = tone === "bad" ? "#991b1b" : tone === "good" ? "#166534" : "#374151";
  return `
  <div style="background:${bg};color:${fg};border-radius:12px;padding:12px 18px;text-align:center;min-width:120px;flex:1">
    <div style="font-size:24px;font-weight:800;line-height:1">${esc(value)}</div>
    <div style="font-size:11px;font-weight:600;margin-top:3px;text-transform:uppercase;letter-spacing:.03em">${esc(
      label
    )}</div>
  </div>`;
}

// ---- Loosely parse Gemini's free-text front-end report into styled blocks ----
function parseFrontEndText(text) {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const blocks = [];
  let topPriority = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^STATUS:/i.test(line)) {
      i++;
      continue;
    }
    if (/^Top priority:/i.test(line)) {
      topPriority = line.replace(/^Top priority:\s*/i, "");
      i++;
      continue;
    }
    const sevMatch = line.match(/^\[(HIGH|MED|LOW)\]\s*(.+)$/i);
    if (sevMatch) {
      const sev = sevMatch[1].toUpperCase();
      const problem = sevMatch[2];
      let fix = "";
      if (i + 1 < lines.length && /^Fix:/i.test(lines[i + 1])) {
        fix = lines[i + 1].replace(/^Fix:\s*/i, "");
        i++;
      }
      blocks.push({ type: "issue", sev, problem, fix });
      i++;
      continue;
    }
    if (/looks OK\.?$/i.test(line)) {
      blocks.push({ type: "ok", content: line });
      i++;
      continue;
    }
    blocks.push({ type: "text", content: line });
    i++;
  }
  return { blocks, topPriority };
}

function renderFrontEndBlocks(text) {
  const { blocks, topPriority } = parseFrontEndText(text);
  let html = "";
  if (topPriority) {
    html += `
    <div style="background:#111827;color:#fff;border-radius:10px;padding:14px 18px;margin-bottom:16px">
      <span style="font-size:11px;font-weight:700;letter-spacing:.05em;color:#fbbf24;text-transform:uppercase">\u2B50 Top priority</span>
      <div style="margin-top:4px;font-size:14.5px;line-height:1.5">${esc(topPriority)}</div>
    </div>`;
  }
  for (const b of blocks) {
    if (b.type === "issue") {
      html += issueCard({ sev: b.sev, title: null, label: "Front-end", url: "#", problem: b.problem, fix: b.fix || "\u2014" });
    } else if (b.type === "ok") {
      html += `<div style="color:#166534;background:#f0fdf4;border-radius:8px;font-size:13.5px;padding:9px 12px;margin-bottom:8px">\u2705 ${esc(
        b.content
      )}</div>`;
    } else {
      html += `<div style="color:#6b7280;font-size:13px;padding:4px 2px;font-style:italic">${esc(b.content)}</div>`;
    }
  }
  return html || `<div style="color:#6b7280;font-size:13px">No AI review text available.</div>`;
}

function pageCard(r) {
  const status = r.httpStatus;
  let statusColor = "#6b7280";
  if (status && status >= 200 && status < 300) statusColor = "#16a34a";
  else if (status && status >= 300 && status < 400) statusColor = "#2563eb";
  else if (status && status >= 400) statusColor = "#dc2626";

  const errCount = (r.consoleErrors || []).length;
  const failCount = (r.failedRequests || []).length;
  const brokenCount = (r.brokenImages || []).length;

  const detailsBlock = (title, items) =>
    items && items.length
      ? `<details style="margin-top:8px">
          <summary style="cursor:pointer;font-size:12.5px;color:#374151;font-weight:600">${esc(
            title
          )} (${items.length})</summary>
          <ul style="margin:6px 0 0 18px;padding:0;font-size:12px;color:#6b7280">
            ${items.map((it) => `<li style="margin-bottom:3px;word-break:break-all">${esc(it)}</li>`).join("")}
          </ul>
        </details>`
      : "";

  const screenshotImg = r.screenshotB64
    ? `<a href="data:image/png;base64,${r.screenshotB64}" target="_blank">
         <img src="data:image/png;base64,${r.screenshotB64}" alt="${esc(
        r.label
      )} screenshot" style="width:100%;max-width:280px;border-radius:10px;border:1px solid #e5e7eb;display:block;margin-top:12px" />
       </a>`
    : "";

  return `
  <div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin-bottom:16px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <div>
        <a href="${esc(r.url)}" target="_blank" style="font-size:16px;font-weight:700;color:#111827;text-decoration:none">${esc(
    r.label
  )}</a>
        <div style="font-size:12px;color:#9ca3af;word-break:break-all;margin-top:2px">${esc(r.url)}</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#fff;background:${statusColor};border-radius:7px;padding:4px 11px;white-space:nowrap">HTTP ${
    status ?? "?"
  }</span>
    </div>
    ${
      r.loadError
        ? `<div style="margin-top:10px;background:#fef2f2;color:#991b1b;border-radius:8px;padding:9px 12px;font-size:12.5px">\u26A0\uFE0F Load error: ${esc(
            r.loadError
          )}</div>`
        : ""
    }
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      ${statPill("Console Errors", errCount, errCount > 0 ? "bad" : "good")}
      ${statPill("Failed Requests", failCount, failCount > 0 ? "bad" : "good")}
      ${statPill("Broken Images", brokenCount, brokenCount > 0 ? "bad" : "good")}
    </div>
    ${detailsBlock("Console errors", r.consoleErrors)}
    ${detailsBlock("Failed requests", r.failedRequests)}
    ${detailsBlock("Broken images", r.brokenImages)}
    ${screenshotImg}
  </div>`;
}

function sevCountsBadges(items) {
  const counts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const i of items) counts[i.sev] = (counts[i.sev] || 0) + 1;
  return ["HIGH", "MED", "LOW"]
    .filter((s) => counts[s] > 0)
    .map((s) => {
      const c = SEV_COLORS[s];
      return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${c.badgeBg}">${counts[s]} ${s}</span>`;
    })
    .join("");
}

// A polished, card-style collapsible group: a colored circular icon, bold
// title, severity badges and an animated chevron on the right. Click the
// whole header row to expand. Falls back gracefully (shows everything open)
// in mail clients that don't support <details>.
function detailsGroup(icon, color, title, items, renderItem) {
  return `
  <details class="grp" style="border:1px solid #e5e7eb;border-radius:14px;margin-bottom:14px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)">
    <summary style="cursor:pointer;padding:16px 18px;display:flex;align-items:center;gap:14px;background:#fff">
      <span style="flex-shrink:0;width:40px;height:40px;border-radius:11px;background:${color}1A;display:flex;align-items:center;justify-content:center;font-size:19px">${icon}</span>
      <span style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:#111827">${esc(title)}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:1px">${items.length} item${items.length === 1 ? "" : "s"} \u2014 click to view</div>
      </span>
      <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${sevCountsBadges(items)}</span>
      <span class="chev" style="flex-shrink:0;font-size:13px;color:#9ca3af">\u25B6</span>
    </summary>
    <div style="padding:4px 18px 18px 18px;border-top:1px solid #f3f4f6;margin-top:2px">
      <div style="height:4px"></div>
      ${items.map(renderItem).join("")}
    </div>
  </details>`;
}

function sectionCard(id, theme, icon, title, subtitle, countLabel, count, innerHtml) {
  return `
  <div id="${id}" style="border-radius:18px;overflow:hidden;margin-bottom:32px;background:${theme.tint};border:1px solid rgba(0,0,0,0.04)">
    <div style="background:${theme.grad};padding:22px 24px;color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:26px">${icon}</span>
          <div>
            <div style="font-size:19px;font-weight:800">${esc(title)}</div>
            <div style="font-size:12.5px;opacity:.9;margin-top:1px">${esc(subtitle)}</div>
          </div>
        </div>
        <div style="background:rgba(255,255,255,.22);border-radius:999px;padding:7px 16px;font-size:13px;font-weight:700;white-space:nowrap">${esc(
          countLabel
        )}: ${esc(count)}</div>
      </div>
    </div>
    <div style="padding:22px 22px 24px 22px">
      ${innerHtml}
    </div>
  </div>`;
}

export function buildHtmlReport({ siteName, dateStr, overallIssues, results, frontEndText, seo, catalogue }) {
  // ----- Website / URL Checks section -----
  const pagesHtml = (results || []).map(pageCard).join("");
  const aiReviewHtml = renderFrontEndBlocks(frontEndText);
  const urlSectionInner = `
    ${pagesHtml}
    <div style="margin-top:8px;background:#fff;border-radius:14px;padding:18px;border:1px solid #e5e7eb">
      <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:12px">\u{1F916} AI Visual Review</div>
      ${aiReviewHtml}
    </div>`;

  // ----- SEO section (grouped per page, collapsible) -----
  let seoInner;
  if (!seo.issues || seo.issues.length === 0) {
    seoInner = `<div style="color:#166534;font-size:14px;background:#dcfce7;border-radius:10px;padding:14px 18px">\u2705 No SEO issues found.</div>`;
  } else {
    const byPage = new Map();
    for (const i of seo.issues) {
      if (!byPage.has(i.label)) byPage.set(i.label, []);
      byPage.get(i.label).push(i);
    }
    seoInner = [...byPage.entries()]
      .map(([label, items]) => detailsGroup("\u{1F4C4}", SECTION_THEME.seo.accent, label, items, issueCard))
      .join("");
  }

  // ----- Catalogue section (grouped by category, collapsible) -----
  let catalogueInner;
  if (!catalogue.issues || catalogue.issues.length === 0) {
    catalogueInner = `<div style="color:#166534;font-size:14px;background:#dcfce7;border-radius:10px;padding:14px 18px">\u2705 ${esc(
      catalogue.totalProducts
    )} products scanned \u2014 all look OK.</div>`;
  } else {
    const byCat = new Map();
    for (const i of catalogue.issues) {
      if (!byCat.has(i.category)) byCat.set(i.category, []);
      byCat.get(i.category).push(i);
    }
    catalogueInner = CATEGORY_ORDER.filter((cat) => byCat.has(cat))
      .map((cat) => {
        const meta = CATEGORY_META[cat] || { label: cat, icon: "\u26A0\uFE0F", color: "#6b7280" };
        const items = byCat.get(cat);
        return detailsGroup(meta.icon, meta.color, meta.label, items, issueCard);
      })
      .join("");
  }

  const overallBg = overallIssues
    ? "linear-gradient(135deg,#b91c1c,#dc2626)"
    : "linear-gradient(135deg,#047857,#10b981)";
  const overallLabel = overallIssues ? "\u26A0\uFE0F ISSUES FOUND" : "\u2705 ALL OK";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(siteName)} \u2014 Morning Site Check \u2014 ${esc(dateStr)}</title>
<style>
  details.grp > summary { list-style: none; }
  details.grp > summary::-webkit-details-marker { display: none; }
  details.grp > summary::marker { content: ""; }
  details.grp[open] .chev { transform: rotate(90deg); }
  details.grp .chev { display: inline-block; transition: transform .15s ease; }
  a { word-break: break-word; }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="max-width:800px;margin:0 auto;padding:28px 16px 56px 16px">

    <div style="background:${overallBg};border-radius:20px;padding:28px 28px;color:#fff;margin-bottom:22px;box-shadow:0 4px 14px rgba(0,0,0,.08)">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;opacity:.85;text-transform:uppercase">Daily Site Check</div>
      <div style="font-size:27px;font-weight:800;margin-top:6px">${esc(siteName)}</div>
      <div style="font-size:13.5px;margin-top:3px;opacity:.9">${esc(dateStr)}</div>
      <div style="display:inline-block;margin-top:14px;background:rgba(255,255,255,.22);padding:7px 16px;border-radius:999px;font-size:13.5px;font-weight:700">${esc(
        overallLabel
      )}</div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
      ${statPill("Pages Checked", (results || []).length, "neutral")}
      ${statPill("SEO Issues", seo.issueCount || 0, (seo.issueCount || 0) > 0 ? "bad" : "good")}
      ${statPill("Catalogue Issues", catalogue.issueCount || 0, (catalogue.issueCount || 0) > 0 ? "bad" : "good")}
      ${statPill("Products Scanned", catalogue.totalProducts || 0, "neutral")}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:28px;flex-wrap:wrap">
      <a href="#website" style="text-decoration:none;flex:1;min-width:150px;text-align:center;background:${SECTION_THEME.website.accent};color:#fff;font-size:13px;font-weight:700;padding:11px 14px;border-radius:10px">\u{1F310} Website</a>
      <a href="#seo" style="text-decoration:none;flex:1;min-width:150px;text-align:center;background:${SECTION_THEME.seo.accent};color:#fff;font-size:13px;font-weight:700;padding:11px 14px;border-radius:10px">\u{1F50D} SEO</a>
      <a href="#catalogue" style="text-decoration:none;flex:1;min-width:150px;text-align:center;background:${SECTION_THEME.catalogue.accent};color:#fff;font-size:13px;font-weight:700;padding:11px 14px;border-radius:10px">\u{1F6CD}\uFE0F Catalogue</a>
    </div>

    ${sectionCard(
      "website",
      SECTION_THEME.website,
      "\u{1F310}",
      "Website / URL Checks",
      "HTTP status, console errors, failed requests, broken images, screenshots + AI visual review",
      "Pages",
      (results || []).length,
      urlSectionInner
    )}

    ${sectionCard(
      "seo",
      SECTION_THEME.seo,
      "\u{1F50D}",
      "SEO Check",
      "Page title, meta description, heading structure, image alt-text",
      "Issues",
      seo.issueCount || 0,
      seoInner
    )}

    ${sectionCard(
      "catalogue",
      SECTION_THEME.catalogue,
      "\u{1F6CD}\uFE0F",
      "Product Catalogue Audit",
      "Price, compare-at price, stock, description and duplicate checks across the store",
      "Issues",
      catalogue.issueCount || 0,
      catalogueInner
    )}

    <div style="text-align:center;color:#9ca3af;font-size:11.5px;margin-top:8px">
      Automated daily check \u2014 generated ${esc(dateStr)}
    </div>
  </div>
</body>
</html>`;
}
