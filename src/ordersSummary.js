// Orders summary for the ADMIN-ONLY email (Romeo + Junaid, not the whole team).
//
// Pulls total and cancelled order counts for three windows — yesterday, the
// last 7 days, and this month-to-date — using the Shopify Admin REST
// orders/count endpoint. Reuses the same OAuth token as the admin audit.
//
// REQUIRES the Shopify app to have the `read_orders` scope. Add it in the Dev
// Dashboard app and re-grant. Without it the count calls return 401/403 and
// this whole summary is skipped (non-fatal) — the rest of the report is
// unaffected. `read_orders` covers the last 60 days of orders, which is all
// three of these windows.

import { getAccessToken } from "./adminAudit.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

// Today's date in Pakistan time (UTC+5, no DST), offset days optional. Returns "YYYY-MM-DD".
function pktDay(offsetDays = 0) {
  const shifted = new Date(Date.now() + 5 * 3600 * 1000 + offsetDays * 86400000);
  return shifted.toISOString().slice(0, 10);
}
const startOfPkt = (ymd) => `${ymd}T00:00:00+05:00`;
const endOfPkt = (ymd) => `${ymd}T23:59:59+05:00`;

async function countOrders({ status, created_at_min, created_at_max }) {
  const store = process.env.SHOPIFY_STORE;
  const token = await getAccessToken();
  const qs = new URLSearchParams({ status, created_at_min, created_at_max });
  const res = await fetch(
    `https://${store}/admin/api/${API_VERSION}/orders/count.json?${qs.toString()}`,
    { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " — the app is missing the read_orders scope (add it in the Dev Dashboard and re-grant)."
        : "";
    throw new Error(`orders/count HTTP ${res.status}${hint} ${body.slice(0, 160)}`);
  }
  const json = await res.json();
  return Number(json.count || 0);
}

// The actual cancelled orders in a window — their order numbers (e.g. "#1042").
// Returns [{ name, created_at }] newest-cancelled first (capped at 250).
async function listCancelledOrders(minIso, maxIso) {
  const store = process.env.SHOPIFY_STORE;
  const token = await getAccessToken();
  const qs = new URLSearchParams({
    status: "cancelled",
    created_at_min: minIso,
    created_at_max: maxIso,
    fields: "name,created_at,cancelled_at",
    limit: "250",
  });
  const res = await fetch(
    `https://${store}/admin/api/${API_VERSION}/orders.json?${qs.toString()}`,
    { headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" } }
  );
  if (!res.ok) return []; // non-fatal — counts still show
  const json = await res.json();
  const orders = Array.isArray(json.orders) ? json.orders : [];
  return orders
    .map((o) => ({ name: o.name, created_at: o.created_at, cancelled_at: o.cancelled_at }))
    .sort((a, b) => new Date(b.cancelled_at || b.created_at) - new Date(a.cancelled_at || a.created_at));
}

// One window = { total, cancelled }.
async function windowCounts(minIso, maxIso) {
  const [total, cancelled] = await Promise.all([
    countOrders({ status: "any", created_at_min: minIso, created_at_max: maxIso }),
    countOrders({ status: "cancelled", created_at_min: minIso, created_at_max: maxIso }),
  ]);
  return { total, cancelled };
}

// Returns { yesterday, last7, month } (each { total, cancelled }) or null if
// orders can't be read (e.g. missing scope). Never throws to the caller.
export async function getOrdersSummary() {
  try {
    if (!process.env.SHOPIFY_STORE) return null;

    const today = pktDay(0);
    const yesterday = pktDay(-1);
    const sevenAgo = pktDay(-7);
    const monthStart = `${today.slice(0, 7)}-01`;
    const nowIso = new Date().toISOString();

    const [yWin, w7, mWin, cancelledThisMonth] = await Promise.all([
      windowCounts(startOfPkt(yesterday), endOfPkt(yesterday)),
      windowCounts(startOfPkt(sevenAgo), nowIso),
      windowCounts(startOfPkt(monthStart), nowIso),
      listCancelledOrders(startOfPkt(monthStart), nowIso),
    ]);

    // Split the month's cancelled orders into non-overlapping recency groups so
    // the email can show them grouped and readable (every order appears once).
    // Grouped by created_at, to match how the counts above are windowed.
    const tToday = Date.parse(startOfPkt(today));
    const tYest = Date.parse(startOfPkt(yesterday));
    const t7 = Date.parse(startOfPkt(sevenAgo));
    const tMonth = Date.parse(startOfPkt(monthStart));
    const groups = { today: [], yesterday: [], week: [], earlier: [] };
    for (const o of cancelledThisMonth) {
      const t = Date.parse(o.created_at);
      if (t >= tToday) groups.today.push(o);
      else if (t >= tYest) groups.yesterday.push(o);
      else if (t >= t7) groups.week.push(o);
      else if (t >= tMonth) groups.earlier.push(o);
    }
    const cancelledBuckets = [
      { label: "Today", orders: groups.today },
      { label: "Yesterday", orders: groups.yesterday },
      { label: "2\u20137 days ago", orders: groups.week },
      { label: "Earlier this month", orders: groups.earlier },
    ].filter((b) => b.orders.length > 0);

    return {
      yesterday: yWin,
      last7: w7,
      month: mWin,
      cancelledOrders: cancelledThisMonth, // flat list (text fallback)
      cancelledBuckets, // grouped by recency for the HTML email
      asOf: today,
    };
  } catch (e) {
    console.error("Orders summary skipped (non-fatal):", e.message);
    return null;
  }
}
