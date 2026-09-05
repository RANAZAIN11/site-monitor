// Run-to-run diffing.
//
// Turns the daily audit from "here is the full wall of findings again" into
// "here is what CHANGED since the last run": what's new today, what got fixed,
// and — crucially — what was already flagged before and is STILL not done.
//
// Only the three *structured* audits are diffed (catalogue, SEO, admin). The
// front-end / Gemini section is free text that gets reworded run to run, so
// diffing it would produce noise; it is intentionally left out.
//
// State is a small JSON file (default state/last-run.json) that the GitHub
// Actions workflow commits back to the repo after each run, so the next run can
// compare against it. Each open issue carries a `firstSeen` date, which is how
// we know how many days a pending task has been sitting unfixed.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const SEV_RANK = { HIGH: 0, MED: 1, LOW: 2 };

// Collapse day-to-day numeric drift so a recurring issue keeps the same
// fingerprint: "Only 3 units left" and "Only 2 units left" are the SAME task.
function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\d+/g, "#") // every number -> #
    .replace(/\s+/g, " ")
    // Drop the plural 's' on a count noun right after a number, so
    // "# images" and "# image" (or "# units"/"# unit") collapse together.
    .replace(/(# [a-z]+)s\b/g, "$1")
    .trim()
    .slice(0, 160);
}

// A stable id for an issue: which audit + category + which product/page +
// the shape of the problem (numbers removed). Reworded fixes or changing
// counts won't make an old issue look brand-new.
function fingerprint({ source, category, label, problem }) {
  const basis = [source, category, label, normalize(problem)].join("|");
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

// Flatten the different audit issue shapes into one comparable list.
//   catalogue issue: { sev, category, title, handle, url, problem, fix }
//   seo issue:       { sev, label, url, problem, fix }          (no category/title)
//   admin issue:     { sev, category, title, label, url, problem, fix }
export function collectIssues({ catalogue, seo, admin }) {
  const out = [];

  for (const i of catalogue?.issues || []) {
    out.push({
      source: "catalogue",
      category: i.category || "catalogue",
      sev: i.sev,
      title: i.title || i.handle,
      label: i.handle || i.title,
      url: i.url,
      problem: i.problem,
      fix: i.fix,
    });
  }
  for (const i of seo?.issues || []) {
    out.push({
      source: "seo",
      category: "seo",
      sev: i.sev,
      title: i.label,
      label: i.label,
      url: i.url,
      problem: i.problem,
      fix: i.fix,
    });
  }
  for (const i of admin?.issues || []) {
    out.push({
      source: "admin",
      category: i.category || "admin",
      sev: i.sev,
      title: i.title || i.label,
      label: i.label || i.title,
      url: i.url,
      problem: i.problem,
      fix: i.fix,
    });
  }

  // De-dupe identical fingerprints inside a single run.
  const seen = new Set();
  const deduped = [];
  for (const it of out) {
    const fp = fingerprint(it);
    if (seen.has(fp)) continue;
    seen.add(fp);
    deduped.push({ ...it, fp });
  }
  return deduped;
}

export async function loadState(path) {
  try {
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" && json.open ? json : { open: {} };
  } catch {
    return { open: {} }; // first run / missing / unreadable -> treat as empty
  }
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

const sortIssues = (arr) =>
  arr.sort(
    (a, b) =>
      (SEV_RANK[a.sev] ?? 3) - (SEV_RANK[b.sev] ?? 3) ||
      (b.ageDays || 0) - (a.ageDays || 0)
  );

// Compare today's issues against the saved state.
//   today = "YYYY-MM-DD"
// Returns { isFirstRun, today, newIssues, pendingIssues, resolvedIssues, nextState }.
//   - newIssues:      present today, not in the previous run
//   - pendingIssues:  present today AND in the previous run  (= "not done yet")
//   - resolvedIssues: in the previous run, gone today        (= fixed)
export function computeDiff(prevState, todayIssues, today) {
  const prevOpen = prevState?.open || {};
  const prevFps = new Set(Object.keys(prevOpen));
  const todayFps = new Set(todayIssues.map((i) => i.fp));
  const isFirstRun = prevFps.size === 0;

  const newIssues = [];
  const pendingIssues = [];

  for (const it of todayIssues) {
    if (prevFps.has(it.fp)) {
      const firstSeen = prevOpen[it.fp].firstSeen || today;
      pendingIssues.push({ ...it, firstSeen, ageDays: daysBetween(firstSeen, today) });
    } else {
      newIssues.push({ ...it, firstSeen: today, ageDays: 0 });
    }
  }

  const resolvedIssues = [];
  for (const fp of prevFps) {
    if (!todayFps.has(fp)) resolvedIssues.push(prevOpen[fp]);
  }

  // Carry firstSeen forward for everything still open today.
  const open = {};
  for (const it of todayIssues) {
    const prev = prevOpen[it.fp];
    open[it.fp] = {
      firstSeen: prev?.firstSeen || today,
      lastSeen: today,
      source: it.source,
      category: it.category,
      sev: it.sev,
      title: it.title,
      label: it.label,
      url: it.url,
      problem: it.problem,
      fix: it.fix,
    };
  }

  return {
    isFirstRun,
    today,
    newIssues: sortIssues(newIssues),
    pendingIssues: sortIssues(pendingIssues),
    resolvedIssues,
    nextState: { generatedAt: today, open },
  };
}

// The pending issues that are serious enough to chase the admin about.
// Default HIGH + MED — LOW is mostly the rolled-up hygiene backlog (e.g.
// "43 products missing alt text") that would otherwise nag every single day.
export function escalatable(pendingIssues, sevList) {
  const allow = new Set(
    (sevList && sevList.length ? sevList : ["HIGH", "MED"]).map((s) => String(s).toUpperCase())
  );
  return pendingIssues.filter((i) => allow.has(String(i.sev).toUpperCase()));
}
