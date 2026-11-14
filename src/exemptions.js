// Products the team has reviewed and confirmed are CORRECT as they are, so a
// specific check must stop flagging them. Each list switches off ONE check
// only — every other audit still runs on these products.
//
// Entries are product handles (the part after /products/ in the URL). A
// product also matches when its title slugifies to the same value, so a
// renamed handle ("snippy-1") is still covered by its title ("Snippy").
// Matching is exact: "snippy" does NOT cover "snippy-peach".

// 3-piece products where the empty Dupatta Fabric metafield is not an error
// (confirmed 2026-11-14 — the issue is on someone else's side, data is right).
export const EXEMPT_3PC_DUPATTA = ["safae", "tasveeray", "sevgi", "snippy", "snippy-peach"];

// Products whose stock findings (out of stock, low stock, draft holding stock,
// negative stock) must not be reported (confirmed 2026-11-14).
export const EXEMPT_STOCK = ["iresine", "gloriana"];

const slug = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");

export function isExempt(list, { handle, title } = {}) {
  const h = String(handle ?? "").toLowerCase();
  const t = slug(title);
  return list.some((e) => e === h || e === t);
}
