// Quick smoke test: verifies the Shopify credentials, scopes and API version,
// then runs the full audit and prints a summary. Sends NO email.
//
// Run from the repo root:   node src/testAdmin.js
import "dotenv/config";
import { auditAdmin, getAccessToken } from "./adminAudit.js";

const store = process.env.SHOPIFY_STORE;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const staticToken = process.env.SHOPIFY_ADMIN_TOKEN;
const version = process.env.SHOPIFY_API_VERSION || "2026-01";

const mask = (v) => (v ? v.slice(0, 8) + "..." + v.slice(-4) : "(NOT SET)");

console.log("Store:        ", store || "(NOT SET)");
console.log("Client ID:    ", mask(clientId));
console.log("Client secret:", mask(clientSecret));
console.log("Static token: ", mask(staticToken));
console.log("API version:  ", version);
console.log("Auth mode:    ", staticToken ? "static token" : "client credentials grant");
console.log("");

if (!store || (!staticToken && !(clientId && clientSecret))) {
  console.error("Need SHOPIFY_STORE plus either SHOPIFY_ADMIN_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET.");
  process.exit(1);
}

try {
  process.stdout.write("Requesting access token... ");
  const tok = await getAccessToken();
  console.log("OK (" + tok.slice(0, 8) + "..." + tok.slice(-4) + ")");
} catch (e) {
  console.log("FAILED");
  console.error("\n" + e.message);
  console.error("\nCommon causes:");
  console.error("  - App not installed on this store");
  console.error("  - App belongs to a different organisation than the store");
  console.error("  - Client ID or Secret copied wrong");
  process.exit(1);
}

try {
  console.log("");
  console.time("audit");
  const admin = await auditAdmin();
  console.timeEnd("audit");
  console.log("");
  console.log(`Products scanned: ${admin.totalProducts}`);
  console.log(`Issues found:     ${admin.issueCount}`);
  console.log("");

  const bySev = { HIGH: 0, MED: 0, LOW: 0 };
  const byCat = {};
  for (const i of admin.issues) {
    bySev[i.sev] = (bySev[i.sev] || 0) + 1;
    byCat[i.category] = (byCat[i.category] || 0) + 1;
  }
  console.log("By severity:", bySev);
  console.log("By category:", byCat);
  console.log("");
  console.log("--- First 15 HIGH issues ---");
  const highs = admin.issues.filter((i) => i.sev === "HIGH").slice(0, 15);
  if (!highs.length) console.log("(none)");
  for (const i of highs) {
    console.log(`\n[${i.category}] ${i.title}`);
    console.log(`  ${i.problem}`);
    console.log(`  Fix: ${i.fix}`);
  }
} catch (e) {
  console.error("\nAUDIT FAILED:", e.message);
  console.error("\nIf this mentions scopes, add read_products / read_inventory / read_locations");
  console.error("to the app's Admin API access scopes in the Dev Dashboard, then release a new version.");
  process.exit(1);
}
