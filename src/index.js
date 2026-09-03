import "dotenv/config";
import { readFile } from "node:fs/promises";
import { checkSite } from "./checkSite.js";
import { analyze } from "./analyze.js";
import { auditCatalogue } from "./catalogueAudit.js";
import { auditAdmin } from "./adminAudit.js";
import { auditSeo } from "./seoAudit.js";
import { buildHtmlReport } from "./report.js";
import { sendEmail, sendWhatsApp } from "./notify.js";

function storeRoot(config) {
  if (config.storeUrl) return config.storeUrl;
  try {
    return new URL(config.pages[0].url).origin; // e.g. https://sahibas.com
  } catch {
    return "";
  }
}

async function main() {
  const config = JSON.parse(
    await readFile(new URL("../config.json", import.meta.url))
  );

  console.log(
    `[${new Date().toISOString()}] Checking ${config.siteName} (${config.pages.length} pages)\u2026`
  );

  // 1) Front-end page look (screenshots -> Gemini)
  const results = await checkSite(config);
  console.log("Pages checked. Sending to Gemini for front-end analysis\u2026");
  const frontEnd = await analyze(config.siteName, results);

  // 2) On-page SEO check (title, meta description, H1, alt text) — rule-based, no AI
  const seo = auditSeo(results);
  console.log(`SEO check: ${seo.issueCount} issue(s).`);

  // 3) Storefront catalogue audit (public products.json -> what a customer sees:
  //    duplicates, images, price, compare-at price, stock, description)
  const root = storeRoot(config);
  console.log("Auditing storefront catalogue at", root, "\u2026");
  const catalogue = await auditCatalogue(root);
  console.log(`Storefront catalogue audit: ${catalogue.issueCount} product issue(s).`);

  // 4) Shopify Admin API audit (season/piece tags, metafields, SKUs, product
  //    shoot, draft products, real stock). Never fatal — if the token is bad or
  //    Shopify is down we still send the rest of the report.
  let admin = { text: "", issueCount: 0, totalProducts: 0, issues: [], error: null };
  try {
    console.log("Auditing Shopify admin data\u2026");
    admin = await auditAdmin();
    console.log(
      `Shopify data audit: ${admin.issueCount} issue(s) across ${admin.totalProducts} products.`
    );
  } catch (e) {
    console.error("Shopify Admin API audit failed (non-fatal):", e.message);
    admin = {
      text: `Shopify Admin API audit FAILED: ${e.message}`,
      issueCount: 0,
      totalProducts: 0,
      issues: [],
      error: e.message,
    };
  }

  const overallIssues =
    catalogue.issueCount > 0 ||
    seo.issueCount > 0 ||
    (admin.severityCounts ? admin.severityCounts.HIGH + admin.severityCounts.MED : admin.issueCount) > 0 ||
    Boolean(admin.error) ||
    /ISSUES FOUND|SCRIPT ERROR/i.test(frontEnd);

  // Plain-text summary — used for WhatsApp and console logs (not the email body anymore)
  const plainTextSummary =
    `OVERALL: ${overallIssues ? "ISSUES FOUND" : "ALL OK"}\n\n` +
    `===== SHOPIFY DATA AUDIT (tags, metafields, SKUs, product shoot, stock) =====\n${admin.text}\n\n` +
    `===== STOREFRONT CATALOGUE AUDIT (price, compare-at price, stock, description, duplicates) =====\n${catalogue.text}\n\n` +
    `===== SEO CHECK =====\n${seo.text}\n\n` +
    `===== FRONT-END PAGE CHECK =====\n${frontEnd}`;

  console.log("\n----- SUMMARY -----\n" + plainTextSummary + "\n-------------------\n");

  const dateStr = new Date().toLocaleString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });

  const htmlReport = buildHtmlReport({
    siteName: config.siteName,
    dateStr,
    overallIssues,
    results,
    frontEndText: frontEnd,
    seo,
    catalogue,
    admin,
  });

  const subject = await sendEmail(config.siteName, plainTextSummary, htmlReport, overallIssues);
  console.log("Email sent:", subject);

  try {
    const sid = await sendWhatsApp(plainTextSummary);
    if (sid) console.log("WhatsApp sent:", sid);
    else console.log("WhatsApp skipped (no Twilio env set).");
  } catch (e) {
    console.error("WhatsApp failed (non-fatal):", e.message);
  }
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  try {
    const { sendEmail } = await import("./notify.js");
    await sendEmail(
      "Site Monitor",
      `OVERALL: SCRIPT ERROR\n\nThe morning check itself failed before it could finish:\n${err.message}\n\nSomebody needs to check the automation.`,
      `<pre style="font-family:monospace;white-space:pre-wrap">OVERALL: SCRIPT ERROR\n\nThe morning check itself failed before it could finish:\n${err.message}\n\nSomebody needs to check the automation.</pre>`,
      true
    );
  } catch {}
  process.exit(1);
});
