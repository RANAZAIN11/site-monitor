import "dotenv/config";
import { readFile } from "node:fs/promises";
import { checkSite } from "./checkSite.js";
import { analyze } from "./analyze.js";
import { auditCatalogue } from "./catalogueAudit.js";
import { auditSeo } from "./seoAudit.js";
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

  // 3) Deep product catalogue audit (Shopify products.json -> rule checks:
  //    duplicates, images, price, compare-at price, stock, description)
  const root = storeRoot(config);
  console.log("Auditing product catalogue at", root, "\u2026");
  const catalogue = await auditCatalogue(root);
  console.log(`Catalogue audit: ${catalogue.issueCount} product issue(s).`);

  const overallIssues =
    catalogue.issueCount > 0 ||
    seo.issueCount > 0 ||
    /ISSUES FOUND|SCRIPT ERROR/i.test(frontEnd);

  const summary =
    `OVERALL: ${overallIssues ? "ISSUES FOUND" : "ALL OK"}\n\n` +
    `===== PRODUCT CATALOGUE AUDIT (price, compare-at price, stock, description, duplicates) =====\n${catalogue.text}\n\n` +
    `===== SEO CHECK =====\n${seo.text}\n\n` +
    `===== FRONT-END PAGE CHECK =====\n${frontEnd}`;

  console.log("\n----- SUMMARY -----\n" + summary + "\n-------------------\n");

  const subject = await sendEmail(config.siteName, summary, results);
  console.log("Email sent:", subject);

  try {
    const sid = await sendWhatsApp(summary);
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
      []
    );
  } catch {}
  process.exit(1);
});
