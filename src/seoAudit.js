// Deterministic (non-AI) SEO checks on the pages checkSite.js already visited.
// Kept rule-based — same style as catalogueAudit.js — so results are
// consistent and don't depend on Gemini "noticing" SEO issues in a screenshot.
//
// Returns both a plain-text summary (for WhatsApp / logs) AND a structured
// `issues` array (for the HTML report), grouped per page.

export function auditSeo(results) {
  const issues = []; // { sev, label, url, problem, fix }

  for (const r of results) {
    if (r.loadError) continue; // page didn't load — front-end check already flags this

    const titleLen = (r.title || "").trim().length;
    if (titleLen === 0) {
      issues.push({
        sev: "HIGH",
        label: r.label,
        url: r.url,
        problem: `Missing page <title>.`,
        fix: `Set a title in Shopify admin (Online Store > Preferences, or the product/page's own SEO section).`,
      });
    } else if (titleLen < 10 || titleLen > 70) {
      issues.push({
        sev: "LOW",
        label: r.label,
        url: r.url,
        problem: `Title is ${titleLen} characters — outside the ideal ~10-70 range for search snippets: "${r.title}".`,
        fix: `Rewrite the page/product title to be descriptive but within Google's recommended length.`,
      });
    }

    const descLen = (r.metaDescription || "").trim().length;
    if (descLen === 0) {
      issues.push({
        sev: "MED",
        label: r.label,
        url: r.url,
        problem: `Missing meta description.`,
        fix: `Add a meta description in Shopify admin > "Search engine listing" section for this page/product.`,
      });
    } else if (descLen < 50 || descLen > 160) {
      issues.push({
        sev: "LOW",
        label: r.label,
        url: r.url,
        problem: `Meta description is ${descLen} characters — outside the ideal ~50-160 range.`,
        fix: `Trim or expand the meta description so it displays fully in search results.`,
      });
    }

    if (r.h1Count === 0) {
      issues.push({
        sev: "MED",
        label: r.label,
        url: r.url,
        problem: `No <h1> heading found on the page.`,
        fix: `Check the theme template for this page type — it should render exactly one H1 (usually the product/page title).`,
      });
    } else if (r.h1Count > 1) {
      issues.push({
        sev: "LOW",
        label: r.label,
        url: r.url,
        problem: `${r.h1Count} <h1> tags found on the page (should be exactly 1).`,
        fix: `Check the theme template/section for a duplicate H1 element.`,
      });
    }

    if (r.imagesMissingAltCount > 0) {
      issues.push({
        sev: "LOW",
        label: r.label,
        url: r.url,
        problem: `${r.imagesMissingAltCount} image(s) missing alt text.`,
        fix: `Add descriptive alt text to these images in admin (accessibility + image SEO).`,
      });
    }
  }

  if (issues.length === 0) {
    return {
      issueCount: 0,
      issues: [],
      text: `Checked ${results.length} page(s) — no SEO issues found.`,
    };
  }

  const order = { HIGH: 0, MED: 1, LOW: 2 };
  const sorted = [...issues].sort((a, b) => order[a.sev] - order[b.sev]);

  const lines = sorted.map(
    (i) => `- [${i.sev}] ${i.label} — ${i.url}\n  Problem: ${i.problem}\n  Fix: ${i.fix}`
  );

  return { issueCount: issues.length, issues, text: lines.join("\n\n") };
}
