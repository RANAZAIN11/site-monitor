// Deep product-catalogue audit. Pulls the store's full product list from
// Shopify's public products.json (no login needed) and flags real data problems
// per product: duplicate/"copy" handles, URL not matching the name, missing
// images, missing/zero price, and obvious test/junk products.

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

async function fetchAllProducts(storeUrl) {
  const products = [];
  for (let page = 1; page <= 40; page++) {
    const url = `${storeUrl.replace(/\/$/, "")}/products.json?limit=250&page=${page}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (SiteMonitorBot)" },
    });
    if (!resp.ok) throw new Error(`products.json ${resp.status} at page ${page}`);
    const data = await resp.json();
    const batch = data.products || [];
    if (batch.length === 0) break;
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

export async function auditCatalogue(storeUrl) {
  let products;
  try {
    products = await fetchAllProducts(storeUrl);
  } catch (err) {
    return {
      issueCount: 0,
      text: `Could not read product catalogue (${err.message}). Skipped catalogue audit.`,
    };
  }

  const root = storeUrl.replace(/\/$/, "");
  const handleMap = new Map(); // handle -> title
  const titleGroups = new Map(); // normalized title -> [handles]
  for (const p of products) {
    handleMap.set(p.handle, p.title);
    const key = slugify(p.title) || (p.title || "").toLowerCase();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(p.handle);
  }

  const issues = []; // { sev, title, handle, problem, fix }

  for (const p of products) {
    const handle = p.handle || "";
    const title = p.title || "(no title)";
    const slug = slugify(title);
    const images = p.images || [];
    const variants = p.variants || [];

    // 1) "copy" in the handle => almost always an accidental duplicate
    if (/(^|-)copy(-|$)/.test(handle) || /copy-of/.test(handle)) {
      issues.push({
        sev: "HIGH",
        title,
        handle,
        problem: `Handle contains "copy" (likely an accidental duplicate product).`,
        fix: `In Shopify admin, check if this duplicates the real "${title}". Delete the copy (or fix its handle) and add a URL redirect from /products/${handle}.`,
      });
      continue;
    }

    // 2) numeric-suffix duplicate whose base handle also exists (e.g. rohini + rohini-2)
    const numMatch = handle.match(/^(.*)-(\d+)$/);
    if (numMatch && handleMap.has(numMatch[1])) {
      issues.push({
        sev: "HIGH",
        title,
        handle,
        problem: `Duplicate of "/products/${numMatch[1]}" (Shopify auto-added "-${numMatch[2]}").`,
        fix: `Confirm the duplicate in admin. Keep one, delete the other, and redirect /products/${handle} to the correct one.`,
      });
      continue;
    }

    // 3) no images at all
    if (images.length === 0) {
      issues.push({
        sev: "HIGH",
        title,
        handle,
        problem: `Product has no images (page will look blank).`,
        fix: `Add product images in Shopify admin > Products > "${title}".`,
      });
    }

    // 4) zero / missing price on every variant
    const allZero =
      variants.length > 0 &&
      variants.every((v) => {
        const price = parseFloat(v.price);
        return !isFinite(price) || price === 0;
      });
    if (allZero) {
      issues.push({
        sev: "HIGH",
        title,
        handle,
        problem: `Price is 0 / missing on all variants.`,
        fix: `Set the correct wholesale price in admin > Products > "${title}".`,
      });
    }

    // 5) test / junk titles
    if (/\b(test|untitled|dummy|asdf|sample product)\b/i.test(title)) {
      issues.push({
        sev: "MED",
        title,
        handle,
        problem: `Title looks like a test/placeholder product.`,
        fix: `Verify it is a real product; if not, delete it.`,
      });
    }

    // 6) URL doesn't match the product name (possible rename with stale handle)
    const titleTokens = slug.split("-").filter((t) => t.length >= 4);
    const handleHasToken = titleTokens.some((t) => handle.includes(t));
    if (titleTokens.length > 0 && !handleHasToken && !/copy|\d+$/.test(handle)) {
      issues.push({
        sev: "MED",
        title,
        handle,
        problem: `URL "/products/${handle}" doesn't match the product name "${title}" (maybe renamed).`,
        fix: `If renamed, update the handle to "${slug}" and add a redirect from the old URL.`,
      });
    }
  }

  const total = products.length;
  if (issues.length === 0) {
    return {
      issueCount: 0,
      text: `${total} products scanned — all look OK.`,
    };
  }

  const order = { HIGH: 0, MED: 1, LOW: 2 };
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  const shown = issues.slice(0, 60);

  const lines = shown.map(
    (i) =>
      `- [${i.sev}] "${i.title}" — ${root}/products/${i.handle}\n` +
      `  Problem: ${i.problem}\n` +
      `  Fix: ${i.fix}`
  );

  let text = `${total} products scanned, ${issues.length} with issues:\n\n${lines.join("\n\n")}`;
  if (issues.length > shown.length) {
    text += `\n\n(+${issues.length - shown.length} more — showing top 60.)`;
  }

  return { issueCount: issues.length, text };
}
