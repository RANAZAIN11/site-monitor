import "dotenv/config";
import { readFile } from "node:fs/promises";
import { checkSite } from "./checkSite.js";
import { analyze } from "./analyze.js";
import { sendEmail, sendWhatsApp } from "./notify.js";

async function main() {
  const config = JSON.parse(
    await readFile(new URL("../config.json", import.meta.url))
  );

  console.log(
    `[${new Date().toISOString()}] Checking ${config.siteName} (${config.pages.length} pages)\u2026`
  );

  const results = await checkSite(config);
  console.log("Pages checked. Sending to Claude for analysis\u2026");

  const summary = await analyze(config.siteName, results);
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
  // best-effort: still tell the team the check itself broke
  try {
    const { sendEmail } = await import("./notify.js");
    await sendEmail(
      "Site Monitor",
      `STATUS: SCRIPT ERROR\n\nThe morning check itself failed before it could analyse the site:\n${err.message}\n\nSomebody needs to check the automation.`,
      []
    );
  } catch {}
  process.exit(1);
});
