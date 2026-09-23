# PROJECT_CONTEXT.md — site-monitor

> Briefing file for a new chat/account. Paste this at the start of a session, or
> keep it committed in the repo root. It reflects the **actual code**, not just
> from-memory notes. Last synced: 2026-09-05.

## 1. What it is

A daily automated monitor for the Sahibas Shopify store (`sahibas.com`).

- **Repo:** `github.com/RANAZAIN11/site-monitor` (local clone: `Desktop\site-monitor` on Zain's Windows PC).
- **Runs on:** GitHub Actions cron — no local machine needed, PC can be off.
- **package.json name:** `site-morning-monitor` (repo/folder is `site-monitor`).
- **Runtime:** Node 20, ESM (`"type": "module"`).
- **Cost:** free — Gemini free tier + GitHub Actions free minutes.

## 2. Architecture — 4 audits + a delivery pipeline

Orchestrated by `src/index.js`, which runs these in order and folds everything
into one report:

1. **Front-end page check** — `checkSite.js` (Playwright/Chromium) visits each page
   in `config.json`, auto-scrolls to trigger lazy images, collects console errors /
   failed requests / broken images / load failures, and takes a full-page
   screenshot. `analyze.js` sends screenshots + logs to **Google Gemini (free tier)**
   for a written summary. `analyze.js` probes several Gemini models and uses the
   first that works (override with `GEMINI_MODEL`), so it survives Google renaming
   models.
2. **On-page SEO** — `seoAudit.js`, deterministic/rule-based (title, meta
   description, H1, alt text) over the pages `checkSite.js` already loaded. No AI.
3. **Storefront catalogue audit** — `catalogueAudit.js` reads the **public**
   `products.json` (no auth). Sees only published products + surface fields:
   duplicate/"copy" handles, URL/handle mismatch, missing images, missing/zero
   price, compare-at errors, stock, description problems, test/junk products.
4. **Shopify Admin API audit** — `adminAudit.js` (see §4; this is the mid-flight
   piece). Talks to the Admin GraphQL API to see what the public feed can't: draft/
   archived products, SKUs, real inventory, and all `custom` metafields.
5. **Run-to-run diff + admin escalation** — `diffState.js`. Fingerprints every
   structured finding (catalogue/SEO/admin; front-end text is excluded) and
   compares against the last run: **new today / resolved / still-pending**. The
   report leads with a "Since the last run" panel. Any pending issue at/above
   `ESCALATE_SEV` (default HIGH,MED) that was flagged before and is **still not
   done** triggers a separate escalation email to `ADMIN_EMAIL`
   (default `rz1753431@gmail.com`), with each task's age in days.

**Delivery** — `notify.js`:
- **Email is primary** (nodemailer/SMTP). The email body **is** the full styled
  HTML report, and the same HTML is also attached as a standalone `.html` file.
- **WhatsApp is optional** (Twilio). Fires only if the Twilio env vars are set;
  otherwise silently skipped. Uses the plain-text summary, not the HTML.
- On a fatal crash, `index.js` still emails an "OVERALL: SCRIPT ERROR" alert.

**Report** — `report.js` builds one self-contained HTML document (inline CSS,
screenshots embedded as base64, collapsible sections). Sections: Front-end,
SEO, Storefront Catalogue, and Shopify Data (Admin) — each grouped by category
and severity (HIGH / MED / LOW).

## 3. Key decisions already made

- **Report format:** redesigned from plain text into one self-contained,
  professional HTML report with collapsible sections. (Plain text still exists as
  the WhatsApp/console summary + email plain-text fallback.)
- **Send time:** 6:17 AM Pakistan time (`PKT = UTC+5` → cron `17 1 * * *`), chosen
  early + off the top of the hour because GitHub's free cron can run 1–3h late; this
  gets the mail to the team well before noon even on a slow day. (Previously 10:00 AM
  / `0 5 * * *`, which was landing as late as ~2:50 PM.) It was
  briefly moved to 11am and then back to 10am — 10am is the current, intended time.
- **Recipients:** `MAIL_TO` is a **comma-separated list** (currently 2 addresses),
  not a single address.
- **Shopify auth switch:** legacy static `shpat_` custom-app tokens were retired by
  Shopify on **Jan 1, 2026**. The Admin audit therefore uses the **OAuth client
  credentials grant** (Dev Dashboard app: Client ID + Secret → 24h token per run).
  A legacy static-token mode still exists in code as a fallback.
- **Gemini free tier** with model auto-probing (no paid AI dependency).
- **Run-to-run diff:** report leads with what changed vs. yesterday; a **still-not-done**
  escalation emails `ADMIN_EMAIL` for carried-over HIGH/MED tasks. State is a JSON
  snapshot (`state/last-run.json`) the Actions workflow **commits back** to the repo
  after each run (needs `permissions: contents: write`). Front-end/Gemini output is
  intentionally not diffed.

## 4. Current state / what's mid-flight

**The Admin API audit (`adminAudit.js`) is already wired in and largely built** —
it is imported by `index.js`, rendered by `report.js`, and has a dedicated smoke
test (`testAdmin.js`). It is treated as **non-fatal**: if auth fails or Shopify is
down, the rest of the report still sends.

What it already checks (per product): piece-count tags & season consistency,
tag-vs-metafield agreement, fabric-vs-season, fabric spelling against a canonical
list, required `custom.*` metafields (more required for 2pc/3pc), wholesale-vs-list
price sanity, per-variant price/compare-at, SKU presence/uniqueness (in-product +
**cross-product duplicate SKU** and shared-SKU-family detection), product-shoot
image count (min 4), alt text, draft-with-stock, out-of-stock-but-live, low stock,
negative/oversold stock. High-volume LOW findings are rolled up into one row each.

**What's actually left to do:**
- **Verify the OAuth credentials + scopes** end-to-end via `node src/testAdmin.js`
  (needs scopes `read_products`, `read_inventory`, `read_locations`).
- **Update stale files** — `README.md` still lists only 3 `src/` files and the old
  7-secret list; `.env.example` has **none** of the `SHOPIFY_*` vars. Both should be
  brought in line with the current code.

## 5. Conventions

**File structure**
```
site-monitor/
├─ config.json                 # siteName + pages to check, timeoutMs, maxImageEdgePx
├─ .env.example                # local-test secrets template (currently STALE)
├─ package.json                # ESM, Node 20; deps: dotenv, nodemailer, playwright, sharp; opt: twilio
├─ README.md                   # user-facing setup (Roman-Urdu; currently STALE)
├─ src/
│  ├─ index.js                 # orchestrator (+ fatal-error alert email)
│  ├─ checkSite.js             # Playwright: visit, scroll, collect problems + screenshot
│  ├─ analyze.js               # Gemini (free) front-end summary, with model probing
│  ├─ seoAudit.js              # rule-based on-page SEO
│  ├─ catalogueAudit.js        # public products.json storefront audit
│  ├─ adminAudit.js            # Shopify Admin GraphQL audit (mid-flight layer)
│  ├─ diffState.js             # run-to-run diff: new/resolved/still-pending + escalation set
│  ├─ ordersSummary.js         # admin-only order counts (yesterday/7d/month) via read_orders
│  ├─ testAdmin.js             # creds/scopes smoke test — no email
│  ├─ report.js                # builds the self-contained HTML report
│  └─ notify.js                # email (primary) + optional WhatsApp
├─ state/
│  └─ last-run.json            # daily issue snapshot, committed back for diffing
└─ .github/workflows/
   └─ daily-check.yml          # 6:17 AM PKT cron + manual dispatch + commit-back of state/
```

**GitHub Secrets**
- Core: `GEMINI_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `MAIL_FROM`, `MAIL_TO` (comma-separated list).
- Optional WhatsApp: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_FROM`, `WHATSAPP_TO`.
- Shopify Admin: `SHOPIFY_STORE` (e.g. `sahiba-clothing.myshopify.com`),
  `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`
  (default `2026-01`). Legacy fallback: `SHOPIFY_ADMIN_TOKEN`.
- `STORE_PUBLIC_URL` (`https://www.sahibas.com`) is set **inline in the workflow**,
  not as a secret (it's only used for links in the report).
- Diff/escalation: `ADMIN_EMAIL` (optional secret; code defaults to
  `rz1753431@gmail.com`), `ESCALATE_SEV` (inline in workflow, default `HIGH,MED`),
  `STATE_FILE` (optional; defaults to `state/last-run.json`).

**Cron:** `17 1 * * *` UTC = 6:17 AM PKT (early + odd minute to dodge GitHub cron congestion, which can be 1–3h).

**Store rules live in code:** the season/piece/fabric/metafield conventions are
constants at the top of `adminAudit.js` (`PIECE_TAGS`, `SEASON_METAFIELD_MAP`,
`PIECES_METAFIELD_MAP`, fabric lists, `REQUIRED_METAFIELDS`, `MIN_IMAGES`,
`LOW_STOCK_THRESHOLD`, `FULLY_AUDIT_DRAFTS`). Edit these when catalogue conventions
change — they are the single source of truth for the audit. Notes on recent tuning:
- **Fabrics:** `CANONICAL_FABRICS` / `ALL_SEASON_FABRICS` include Jacquard and Manaar
  (real fabrics the store sells; "Mannar" kept as an alias). Add new fabrics to both
  lists. Note: "Viscouse" is intentionally still flagged — it's a typo of "Viscose".
- **Dupatta fabric:** dupatta is exempt from BOTH fabric checks — "not a recognised
  fabric" AND the fabric-vs-season mismatch (a winter suit can carry a Voile/Cambric
  dupatta). Both checks still apply to `shirt_fabric` / `trouser_fabric`.
- **Metafield checks:** `trouser_fabric` and `bottom_style` "empty" flags were removed
  (not every product has a trouser/bottom). `REQUIRED_IF_2PC` is now empty;
  `dupatta_fabric` is still required for 3pc (`REQUIRED_IF_3PC`).
- **Admin orders summary (`ordersSummary.js`):** the admin email carries total +
  cancelled order counts for yesterday / last 7 days / this month, PLUS the order
  numbers of this month's cancelled orders (cancelled only). Sent DAILY to
  `ADMIN_EMAIL` only (not the team `MAIL_TO`), even with no pending tasks. Needs the
  Shopify `read_orders` scope; without it the summary is skipped (non-fatal).
- **Both-seasons tag:** a product tagged for Summer AND Winter is flagged as an error,
  EXCEPT when its primary fabric (shirt→trouser→dupatta) is all-season (silk, poly
  silk, chiffon, …) — those are legitimately year-round. Any other fabric tagged for
  both seasons stays flagged.
- **Report shows everything:** `MAX_ROWS_PER_CATEGORY` is `Infinity` — the HTML report
  never truncates a category (no "+N more not listed"). The top "Since the last run"
  panel is still a capped summary; the full items always appear in their sections below.
- **SKUs:** the admin audit flags only **missing** SKUs and **duplicate** SKUs
  (inside a product and across the store). SKU *formatting* (size code inside the
  SKU, one shared pattern per product, shared-family heuristic) is deliberately
  NOT checked — the store's SKUs are correct by convention.
- **Numbered products:** `KNOWN_DISTINCT_HANDLES` in `catalogueAudit.js` lists
  handles like `aari-2` that are real follow-up products, so the numeric-suffix
  duplicate check leaves them alone. A genuine accidental duplicate (base handle
  exists, not allowlisted) is still flagged.

**Wholesale pricing:** wholesale is read from the `custom.wholesale_price` money
metafield; catalogue/pricing logic uses wholesale, never retail, unless stated.

**Config (`config.json`):** `pages[]` includes a "Sample Product" entry that must
point at a real live product handle (`/products/<handle>`).
