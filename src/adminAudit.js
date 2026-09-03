// Deep Shopify ADMIN API audit.
//
// Unlike catalogueAudit.js (which reads the PUBLIC /products.json and so only
// ever sees published products and surface-level fields), this module talks to
// the Shopify Admin GraphQL API with a private app token. That lets it see
// draft/archived products, SKUs, real inventory numbers, and all the `custom`
// metafields the catalogue builder depends on.
//
// AUTH — two supported modes:
//
//   A) Client credentials grant (Dev Dashboard app — the only option for apps
//      created after 1 Jan 2026). The app exchanges its own ID + secret for a
//      24-hour token on every run. Set:
//        SHOPIFY_STORE           = sahiba-clothing.myshopify.com
//        SHOPIFY_CLIENT_ID       = <Client ID from the Dev Dashboard app>
//        SHOPIFY_CLIENT_SECRET   = shpss_xxxxxxxx
//
//   B) Static token (legacy admin-created custom apps only). Set:
//        SHOPIFY_STORE           = sahiba-clothing.myshopify.com
//        SHOPIFY_ADMIN_TOKEN     = shpat_xxxxxxxx
//
// If SHOPIFY_ADMIN_TOKEN is present it is used as-is; otherwise the module
// falls back to the client credentials grant.
//
// Optional:
//   SHOPIFY_API_VERSION  = 2026-01   (default)
//   STORE_PUBLIC_URL     = https://www.sahibas.com  (for links in the report)
//
// Returns the SAME shape as catalogueAudit.js so report.js can render it:
//   { text, issueCount, totalProducts, issues: [{ category, sev, title, url, label, problem, fix }] }

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const PUBLIC_URL = (process.env.STORE_PUBLIC_URL || "https://www.sahibas.com").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// STORE RULES — edit these as the catalogue conventions change.
// ---------------------------------------------------------------------------

// The six canonical piece-count tags. Anything outside this list is not a
// piece tag.
const PIECE_TAGS = [
  "1 Pc Summer",
  "2 Pc Summer",
  "3 Pc Summer",
  "1 Pc Winter",
  "2 Pc Winter",
  "3 Pc Winter",
];

// custom.season metafield -> season. "All Season" is treated as compatible
// with everything, so it never raises a mismatch on its own.
const SEASON_METAFIELD_MAP = {
  "summer wear": "summer",
  "winter wear": "winter",
  "all season": "any",
};

// custom.number_of_pieces metafield -> piece count.
const PIECES_METAFIELD_MAP = {
  "1 - piece": 1,
  "2 - piece": 2,
  "3 - piece": 3,
};

// Fabric -> season. Used to catch "summer fabric tagged as winter" and the
// reverse. Anything in ALL_SEASON never raises a mismatch.
const WINTER_FABRICS = ["dhanak", "khaddar", "velvet", "marina", "wool", "karandi", "pashmina", "linen"];
const SUMMER_FABRICS = ["lawn", "cotton", "voile", "cambric", "cotton net", "swiss lawn"];
const ALL_SEASON_FABRICS = ["poly silk", "chiffon", "organza", "net", "viscose", "silk", "grip"];

// Canonical spelling for every fabric we know. Used for typo / casing checks
// (this is what catches "Poly SIlk").
const CANONICAL_FABRICS = [
  "Lawn", "Cotton", "Voile", "Cambric", "Cotton Net", "Swiss Lawn",
  "Dhanak", "Khaddar", "Velvet", "Marina", "Wool", "Karandi", "Pashmina", "Linen",
  "Poly Silk", "Chiffon", "Organza", "Net", "Viscose", "Silk", "Grip",
];

// Metafields (custom namespace) every product must have.
const REQUIRED_METAFIELDS = [
  { key: "number_of_pieces", label: "Number Of Pieces", sev: "HIGH" },
  { key: "season", label: "Season", sev: "HIGH" },
  { key: "shirt_fabric", label: "Shirt Fabric", sev: "MED" },
  { key: "wholesale_price", label: "Wholesale Price", sev: "HIGH" },
  { key: "top_style", label: "Top Style", sev: "LOW" },
  { key: "top_fit", label: "Top Fit", sev: "LOW" },
  { key: "work_technique", label: "Work Technique", sev: "LOW" },
  { key: "lining_attached", label: "Lining Attached", sev: "LOW" },
];
// Extra metafields required once the product has a bottom / dupatta.
const REQUIRED_IF_2PC = [
  { key: "trouser_fabric", label: "Trouser Fabric", sev: "MED" },
  { key: "bottom_style", label: "Bottom Style", sev: "LOW" },
];
const REQUIRED_IF_3PC = [{ key: "dupatta_fabric", label: "Dupatta Fabric", sev: "MED" }];

// Product shoot expectations.
const MIN_IMAGES = 4;          // hero + 3 detail crops for the catalogue
const LOW_STOCK_THRESHOLD = 5; // total units across all sizes

// Draft products are work-in-progress, so they only get a couple of checks
// (holding stock, duplicate SKUs). Set to true to audit them fully.
const FULLY_AUDIT_DRAFTS = false;

// High-volume LOW checks are rolled into ONE summary row each instead of one
// row per product, otherwise the email becomes unreadable.
const AGGREGATE_SAMPLE = 20;

// ---------------------------------------------------------------------------
// GraphQL plumbing
// ---------------------------------------------------------------------------

const AUDIT_QUERY = `
query AuditProducts($cursor: String) {
  products(first: 10, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      status
      tags
      totalInventory
      mediaCount { count }
      media(first: 5) { nodes { alt mediaContentType } }
      metafields(namespace: "custom", first: 25) { nodes { key value } }
      variants(first: 12) {
        nodes { id title sku price compareAtPrice inventoryQuantity }
      }
    }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cached for the lifetime of the process. The daily job runs once, so this
// fetches exactly one token per run.
let cachedToken = null;

// Client credentials grant:
//   POST https://{shop}/admin/oauth/access_token
//   body: client_id, client_secret, grant_type=client_credentials
// Returns a shpat_ token valid for ~24 hours.
async function getAccessToken() {
  if (cachedToken) return cachedToken;

  const store = process.env.SHOPIFY_STORE;
  if (!store) throw new Error("SHOPIFY_STORE must be set (e.g. sahiba-clothing.myshopify.com).");

  // Mode B — static token supplied directly.
  const staticToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (staticToken) {
    cachedToken = staticToken;
    return cachedToken;
  }

  // Mode A — exchange client credentials for a token.
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard app), or SHOPIFY_ADMIN_TOKEN (legacy custom app)."
    );
  }

  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Token request failed (HTTP ${res.status}): ${body.slice(0, 300)}\n` +
        "Check that the app is installed on this store, belongs to your own organisation, " +
        "and that the Client ID / Secret are correct."
    );
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${body.slice(0, 200)}`);
  }
  if (!json.access_token) {
    throw new Error(`Token endpoint returned no access_token: ${body.slice(0, 300)}`);
  }

  cachedToken = json.access_token;
  return cachedToken;
}

async function shopifyGraphql(query, variables, attempt = 1) {
  const store = process.env.SHOPIFY_STORE;
  const token = await getAccessToken();

  const res = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`Shopify API failed after 5 attempts (HTTP ${res.status})`);
    await sleep(1500 * attempt);
    return shopifyGraphql(query, variables, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();

  if (json.errors && json.errors.length) {
    const throttled = json.errors.some((e) => /throttl/i.test(e.message || ""));
    if (throttled && attempt < 5) {
      await sleep(2000 * attempt);
      return shopifyGraphql(query, variables, attempt + 1);
    }
    throw new Error("Shopify GraphQL error: " + json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

async function fetchAllProducts() {
  const all = [];
  let cursor = null;
  let guard = 0;
  do {
    const data = await shopifyGraphql(AUDIT_QUERY, { cursor });
    all.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    if (cursor) await sleep(350); // stay under the leaky bucket
  } while (cursor && ++guard < 200);
  return all;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const lc = (s) => String(s ?? "").trim().toLowerCase();

function metaMap(product) {
  const m = {};
  for (const n of product.metafields?.nodes || []) m[n.key] = n.value;
  return m;
}

// custom.wholesale_price is a `money` metafield -> {"amount":"2350.00","currency_code":"PKR"}
function moneyAmount(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const n = Number(parsed.amount);
    return Number.isFinite(n) ? n : null;
  } catch {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
}

function fabricSeason(value) {
  const v = lc(value);
  if (!v) return null;
  if (ALL_SEASON_FABRICS.some((f) => v.includes(f))) return "any";
  if (WINTER_FABRICS.some((f) => v.includes(f))) return "winter";
  if (SUMMER_FABRICS.some((f) => v.includes(f))) return "summer";
  return null; // unknown fabric
}

function sizeToken(variantTitle) {
  // "S / Lawn" -> "S", "XL" -> "XL"
  return String(variantTitle || "").split("/")[0].trim().toUpperCase();
}

// Strip the size segment out of a SKU so variants of one product collapse to
// a single base: SAH-C-P-S-5 (size S) -> SAH-C-P-5
function skuBase(sku, size) {
  const parts = String(sku || "").split("-");
  const idx = parts.findIndex((p) => p.trim().toUpperCase() === size);
  if (idx === -1) return parts.join("-").toUpperCase();
  parts.splice(idx, 1);
  return parts.join("-").toUpperCase();
}

// Also strip a trailing numeric suffix so SAH-C-P-5 and SAH-C-P-0 collapse to
// SAH-C-P — used to spot two different products sharing a SKU family.
function skuFamily(base) {
  return base.replace(/-\d+$/, "");
}

function productUrl(handle) {
  return `${PUBLIC_URL}/products/${handle}`;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export { getAccessToken };

export async function auditAdmin() {
  const products = await fetchAllProducts();
  const issues = [];

  const push = (product, category, sev, problem, fix) =>
    issues.push({
      category,
      sev,
      title: product.title || product.handle,
      label: product.handle,
      url: productUrl(product.handle),
      problem,
      fix,
    });

  // Cross-product indexes, filled on the first pass.
  const skuOwners = new Map();    // exact SKU -> [{title, handle}]
  const familyOwners = new Map(); // SKU family -> Set of handles

  // High-volume LOW findings get rolled up into one row each at the end.
  const bucket = { noAlt: [], noAllProducts: [], noCollectionTag: [], noSizeChart: [] };

  for (const p of products) {
    const meta = metaMap(p);
    const variants = p.variants?.nodes || [];
    const isArchived = p.status === "ARCHIVED";
    const isDraft = p.status === "DRAFT";
    // Full check set runs on live products only.
    const full = p.status === "ACTIVE" || (isDraft && FULLY_AUDIT_DRAFTS);

    // ---------- 1. TAGS & SEASON ----------
    if (full) {
    const pieceTags = (p.tags || []).filter((t) => PIECE_TAGS.includes(t));

    let tagPieces = null;
    let tagSeason = null;
    if (pieceTags.length === 0) {
      if (!isArchived) {
        push(
          p,
          "tags",
          "HIGH",
          "No piece-count tag at all. The catalogue builder groups products by these tags, so this product will be silently skipped from every wholesale catalogue.",
          `Add exactly one of: ${PIECE_TAGS.join(", ")}.`
        );
      }
    } else if (pieceTags.length > 1) {
      const seasons = new Set(pieceTags.map((t) => (/summer/i.test(t) ? "summer" : "winter")));
      const counts = new Set(pieceTags.map((t) => parseInt(t, 10)));
      if (seasons.size > 1) {
        push(
          p,
          "tags",
          "HIGH",
          `Tagged for BOTH seasons at once: ${pieceTags.join(" + ")}. It will appear in the summer and the winter catalogue.`,
          "Keep only the correct season tag. If it genuinely sells year-round, set custom.season to All Season and pick one tag."
        );
      }
      if (counts.size > 1) {
        push(
          p,
          "tags",
          "HIGH",
          `Conflicting piece counts in tags: ${pieceTags.join(" + ")}.`,
          "A product cannot be 1pc and 2pc. Remove the wrong tag."
        );
      }
      tagPieces = [...counts][0];
      tagSeason = [...seasons][0];
    } else {
      tagPieces = parseInt(pieceTags[0], 10);
      tagSeason = /summer/i.test(pieceTags[0]) ? "summer" : "winter";
    }

    // Tag season vs custom.season metafield
    const metaSeason = SEASON_METAFIELD_MAP[lc(meta.season)];
    if (tagSeason && metaSeason && metaSeason !== "any" && metaSeason !== tagSeason) {
      push(
        p,
        "tags",
        "HIGH",
        `Tagged "${pieceTags[0]}" but the Season metafield says "${meta.season}". Tag and metafield disagree.`,
        `Set custom.season to "${tagSeason === "summer" ? "Summer Wear" : "Winter Wear"}", or fix the tag.`
      );
    }

    // Tag piece count vs custom.number_of_pieces metafield
    const metaPieces = PIECES_METAFIELD_MAP[lc(meta.number_of_pieces)];
    if (tagPieces && metaPieces && metaPieces !== tagPieces) {
      push(
        p,
        "tags",
        "HIGH",
        `Tag says ${tagPieces}-piece but the Number Of Pieces metafield says "${meta.number_of_pieces}".`,
        "Make the tag and the metafield agree — the catalogue subtitle reads from the metafield."
      );
    }

    // Fabric vs season
    for (const key of ["shirt_fabric", "trouser_fabric", "dupatta_fabric"]) {
      const val = meta[key];
      if (!val) continue;
      const fs = fabricSeason(val);
      if (fs && fs !== "any" && tagSeason && fs !== tagSeason) {
        push(
          p,
          "tags",
          "MED",
          `${key.replace(/_/g, " ")} is "${val}" (a ${fs} fabric) but the product is tagged ${tagSeason}.`,
          `Either re-tag it as ${fs}, or correct the fabric value.`
        );
      }
      // Typo / casing check
      const canon = CANONICAL_FABRICS.find((c) => lc(c) === lc(val));
      if (canon && canon !== String(val).trim()) {
        push(
          p,
          "metafields",
          "LOW",
          `${key.replace(/_/g, " ")} is spelled "${val}" instead of "${canon}".`,
          `Correct it to "${canon}" so filters and catalogue text stay consistent.`
        );
      } else if (!canon && fs === null) {
        push(
          p,
          "metafields",
          "MED",
          `${key.replace(/_/g, " ")} value "${val}" is not a recognised fabric — likely a typo or a new fabric.`,
          "Fix the spelling, or add it to CANONICAL_FABRICS in adminAudit.js if it is genuinely new."
        );
      }
    }

    // Collection tags
    if (tagSeason) {
      const wantCollection = tagSeason === "summer" ? "Summer Collection" : "Winter Collection";
      if (!(p.tags || []).includes(wantCollection)) {
        bucket.noCollectionTag.push(`${p.title} (needs "${wantCollection}")`);
      }
    }
    if (!(p.tags || []).includes("All products")) {
      bucket.noAllProducts.push(p.title);
    }

    // ---------- 2. METAFIELDS ----------
    const pieces = metaPieces || tagPieces || 1;
    let required = [...REQUIRED_METAFIELDS];
    if (pieces >= 2) required = required.concat(REQUIRED_IF_2PC);
    if (pieces >= 3) required = required.concat(REQUIRED_IF_3PC);

    for (const r of required) {
      const v = meta[r.key];
      if (v === undefined || String(v).trim() === "") {
        push(
          p,
          "metafields",
          isArchived ? "LOW" : r.sev,
          `Metafield "${r.label}" (custom.${r.key}) is empty.`,
          r.key === "wholesale_price"
            ? "Fill it in — the wholesale catalogue builder cannot price this product without it."
            : `Fill in ${r.label} on the product page.`
        );
      }
    }

    // Product shoot support files
    if (!meta.size_chart && !meta.size_chart_table) {
      bucket.noSizeChart.push(p.title);
    }

    // ---------- 3. PRICE & WHOLESALE ----------
    const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
    const compareAts = variants
      .map((v) => (v.compareAtPrice === null ? null : Number(v.compareAtPrice)))
      .filter((n) => Number.isFinite(n) && n > 0);
    const minRetail = prices.length ? Math.min(...prices) : null;
    // The list price is the compare-at when the product is on sale, otherwise
    // the selling price. Comparing wholesale to a temporary sale price would
    // flag every discounted article.
    const listPrice = compareAts.length ? Math.min(...compareAts) : minRetail;
    const wholesale = moneyAmount(meta.wholesale_price);
    const wholesaleIntl = moneyAmount(meta.wholesale_international);

    if (wholesale !== null && listPrice !== null && wholesale >= listPrice) {
      push(
        p,
        "admin_price",
        "HIGH",
        `Wholesale price (${wholesale}) is not below the list price (${listPrice}). Wholesale buyers would pay retail or more.`,
        "Correct custom.wholesale_price."
      );
    } else if (wholesale !== null && minRetail !== null && wholesale >= minRetail) {
      push(
        p,
        "admin_price",
        "MED",
        `Currently selling at ${minRetail}, which is at or below the wholesale price of ${wholesale}. Fine for a short sale, a loss otherwise.`,
        "Check that this discount is intentional and time-limited."
      );
    }
    if (wholesale !== null && wholesaleIntl !== null && wholesaleIntl < wholesale) {
      push(
        p,
        "admin_price",
        "MED",
        `International wholesale (${wholesaleIntl}) is lower than local wholesale (${wholesale}).`,
        "Check custom.wholesale_international — international is normally the higher of the two."
      );
    }
    if (prices.length > 1 && new Set(prices).size > 1) {
      push(
        p,
        "admin_price",
        "MED",
        `Sizes are priced differently: ${[...new Set(prices)].join(" / ")}.`,
        "Unless this is deliberate, set one price across all sizes."
      );
    }
    for (const v of variants) {
      const price = Number(v.price);
      const cap = v.compareAtPrice === null ? null : Number(v.compareAtPrice);
      if (!Number.isFinite(price) || price <= 0) {
        push(p, "admin_price", "HIGH", `Variant "${v.title}" has no valid price.`, "Set a price on this variant.");
      }
      if (cap !== null && Number.isFinite(price) && cap > 0 && cap <= price) {
        push(
          p,
          "admin_price",
          "MED",
          `Variant "${v.title}": compare-at price (${cap}) is not above the selling price (${price}), so no discount shows.`,
          "Raise the compare-at price or clear it."
        );
      }
      if (cap !== null && Number.isFinite(price) && price > 0 && cap / price > 2.2) {
        push(
          p,
          "admin_price",
          "LOW",
          `Variant "${v.title}": compare-at price (${cap}) is more than 2.2x the selling price (${price}) — an implausible discount.`,
          "Check the compare-at price; inflated discounts can trip ad-platform review."
        );
      }
    }

    } // end full-check block (tags / metafields / price / media)

    // ---------- 4. SKUs ----------
    const seenInProduct = new Map();
    const bases = new Set();

    for (const v of variants) {
      const sku = String(v.sku || "").trim();
      const size = sizeToken(v.title);

      if (!sku) {
        if (full) push(p, "sku", "HIGH", `Variant "${v.title}" has NO SKU.`, "Assign a SKU — stock and order reports cannot match this variant without one.");
        continue;
      }

      if (seenInProduct.has(sku) && full) {
        push(
          p,
          "sku",
          "HIGH",
          `SKU "${sku}" is used twice inside this product ("${seenInProduct.get(sku)}" and "${v.title}").`,
          "Give each size its own unique SKU."
        );
      } else if (!seenInProduct.has(sku)) {
        seenInProduct.set(sku, v.title);
      }

      if (!skuOwners.has(sku)) skuOwners.set(sku, []);
      skuOwners.get(sku).push({ title: p.title, handle: p.handle, variant: v.title });

      if (size && full && !sku.toUpperCase().split("-").includes(size)) {
        push(
          p,
          "sku",
          "MED",
          `Variant "${v.title}" has SKU "${sku}", which does not contain the size code ${size}.`,
          "Keep the size code inside the SKU so picking and packing stays readable."
        );
      }

      const base = skuBase(sku, size);
      bases.add(base);
      const fam = skuFamily(base);
      if (!familyOwners.has(fam)) familyOwners.set(fam, new Set());
      familyOwners.get(fam).add(p.handle);
    }

    if (bases.size > 1 && full) {
      push(
        p,
        "sku",
        "MED",
        `Sizes of this product do not share one SKU pattern — after removing the size code the SKUs are: ${[...bases].join(", ")}.`,
        "Rebuild the SKUs on one consistent pattern, e.g. SAH-XXXX-<SIZE>-<n> with the same <n> across all sizes."
      );
    }

    // ---------- 5. MEDIA / PRODUCT SHOOT ----------
    if (full) {
    const imageCount = p.mediaCount?.count ?? 0;
    if (imageCount === 0) {
      push(p, "media", "HIGH", "Product has no images at all.", "Upload the product shoot.");
    } else if (imageCount < MIN_IMAGES) {
      push(
        p,
        "media",
        "MED",
        `Only ${imageCount} image${imageCount === 1 ? "" : "s"}. The catalogue layout needs a hero shot plus 3 detail crops (neckline, embroidery, back).`,
        `Add at least ${MIN_IMAGES - imageCount} more image(s).`
      );
    }
    const sampled = p.media?.nodes || [];
    if (sampled.length && sampled.every((m) => !String(m.alt || "").trim())) {
      bucket.noAlt.push(p.title);
    }

    } // end media block

    // ---------- 6. STATUS & STOCK ----------
    const totalStock = p.totalInventory ?? 0;
    if (p.status === "DRAFT" && totalStock > 0) {
      push(
        p,
        "status",
        "MED",
        `Status is DRAFT but ${totalStock} unit(s) are in stock — the product is hidden from the store while holding inventory.`,
        "Either set it Active to sell it, or move the stock if it is discontinued."
      );
    }
    if (p.status === "ACTIVE" && totalStock <= 0 && !isArchived) {
      push(
        p,
        "status",
        "HIGH",
        "Live on the store but completely out of stock across every size.",
        "Restock it or set it to Draft so customers do not land on a dead page."
      );
    } else if (p.status === "ACTIVE" && totalStock > 0 && totalStock < LOW_STOCK_THRESHOLD) {
      push(
        p,
        "status",
        "MED",
        `Only ${totalStock} unit(s) left in total across all sizes.`,
        "Restock soon or plan to retire the article."
      );
    }
    for (const v of variants) {
      if (Number(v.inventoryQuantity) < 0) {
        push(
          p,
          "status",
          "HIGH",
          `Variant "${v.title}" has NEGATIVE stock (${v.inventoryQuantity}) — oversold.`,
          "Recount and correct the inventory for this variant."
        );
      }
    }
  }

  // ---------- Rolled-up LOW findings ----------
  const rollUp = (names, category, heading, problemFn, fix) => {
    if (!names.length) return;
    const sample = names.slice(0, AGGREGATE_SAMPLE).join(", ");
    const more = names.length > AGGREGATE_SAMPLE ? `, +${names.length - AGGREGATE_SAMPLE} more` : "";
    issues.push({
      category,
      sev: "LOW",
      title: `${heading} (${names.length} products)`,
      label: heading,
      url: `${PUBLIC_URL}/collections/all`,
      problem: `${problemFn(names.length)} Affected: ${sample}${more}.`,
      fix,
    });
  };

  rollUp(
    bucket.noAlt,
    "media",
    "No image alt text",
    (n) => `${n} live products have no alt text on any product image.`,
    "Bulk-edit alt text in Shopify admin — use the product name plus fabric and colour."
  );
  rollUp(
    bucket.noSizeChart,
    "metafields",
    "No size chart",
    (n) => `${n} live products have neither a size_chart nor a size_chart_table metafield.`,
    "Attach the standard size chart via bulk edit."
  );
  rollUp(
    bucket.noAllProducts,
    "tags",
    'Missing "All products" tag',
    (n) => `${n} live products are missing the "All products" tag and will not appear in the catch-all collection.`,
    'Bulk-add the "All products" tag.'
  );
  rollUp(
    bucket.noCollectionTag,
    "tags",
    "Missing season collection tag",
    (n) => `${n} live products are missing their Summer/Winter Collection tag, so they will not show on that collection page.`,
    "Bulk-add the matching collection tag."
  );

  // ---------- Cross-product SKU checks ----------
  for (const [sku, owners] of skuOwners) {
    const handles = [...new Set(owners.map((o) => o.handle))];
    if (handles.length > 1) {
      const first = owners[0];
      issues.push({
        category: "sku",
        sev: "HIGH",
        title: `Duplicate SKU: ${sku}`,
        label: sku,
        url: productUrl(first.handle),
        problem: `SKU "${sku}" is used by ${handles.length} different products: ${owners
          .map((o) => `${o.title} (${o.variant})`)
          .join(", ")}.`,
        fix: "Make every SKU unique across the whole store — duplicates corrupt stock counts and sales reports.",
      });
    }
  }
  for (const [fam, handles] of familyOwners) {
    if (handles.size > 1 && fam.length >= 5) {
      issues.push({
        category: "sku",
        sev: "LOW",
        title: `Shared SKU family: ${fam}`,
        label: fam,
        url: productUrl([...handles][0]),
        problem: `${handles.size} different products use SKUs built on the same "${fam}" prefix: ${[...handles].join(", ")}.`,
        fix: "Give each article its own prefix so a mis-typed digit cannot silently move stock between two products.",
      });
    }
  }

  // ---------- Plain-text summary (WhatsApp / console) ----------
  const bySev = { HIGH: 0, MED: 0, LOW: 0 };
  for (const i of issues) bySev[i.sev] = (bySev[i.sev] || 0) + 1;

  const lines = [
    `Scanned ${products.length} products via Shopify Admin API.`,
    `${issues.length} issue(s): ${bySev.HIGH} HIGH, ${bySev.MED} MED, ${bySev.LOW} LOW.`,
    "",
  ];
  const order = ["tags", "sku", "metafields", "admin_price", "media", "status"];
  for (const cat of order) {
    const items = issues.filter((i) => i.category === cat);
    if (!items.length) continue;
    lines.push(`-- ${cat.toUpperCase()} (${items.length}) --`);
    for (const i of items.slice(0, 25)) lines.push(`[${i.sev}] ${i.title}: ${i.problem}`);
    if (items.length > 25) lines.push(`...and ${items.length - 25} more.`);
    lines.push("");
  }

  return {
    text: lines.join("\n").trim() || "No Admin API issues found.",
    issueCount: issues.length,
    severityCounts: bySev,
    totalProducts: products.length,
    issues,
  };
}
