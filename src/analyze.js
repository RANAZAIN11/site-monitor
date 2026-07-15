// Sends screenshots + logs to Google Gemini (FREE tier). It PROBES several
// candidate models with your key and uses the first one that actually works,
// so it keeps running even when Google renames/retires models.
// Optional: set a GEMINI_MODEL secret to force a specific model name.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function candidateModels(key) {
  const list = [];
  if (process.env.GEMINI_MODEL) {
    list.push("models/" + process.env.GEMINI_MODEL.replace(/^models\//, ""));
  }
  try {
    const resp = await fetch(`${API_BASE}/models?key=${key}`);
    if (resp.ok) {
      const data = await resp.json();
      const usable = (data.models || []).filter((m) =>
        (m.supportedGenerationMethods || []).includes("generateContent")
      );
      const flash = usable.filter((m) => /flash/i.test(m.name));
      const rest = usable.filter((m) => !/flash/i.test(m.name));
      for (const m of [...flash, ...rest]) list.push(m.name);
    }
  } catch {}
  for (const n of [
    "models/gemini-flash-latest",
    "models/gemini-flash-lite-latest",
    "models/gemini-1.5-flash-latest",
    "models/gemini-1.5-flash",
  ]) {
    list.push(n);
  }
  return [...new Set(list)];
}

async function probe(model, key) {
  try {
    const resp = await fetch(`${API_BASE}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function pickWorkingModel(key) {
  const candidates = await candidateModels(key);
  for (const model of candidates) {
    if (await probe(model, key)) return model;
  }
  throw new Error("No usable Gemini model for this key. Tried: " + candidates.join(", "));
}

export async function analyze(siteName, results) {
  const key = process.env.GEMINI_API_KEY;
  const model = await pickWorkingModel(key);
  console.log("Using Gemini model:", model);

  const parts = [];

  parts.push({
    text:
      `You are a senior QA + web-developer assistant reviewing the front-end of the e-commerce ` +
      `site "${siteName}". For each page you get a technical log (HTTP status, console errors, ` +
      `failed network requests, broken image URLs) plus a full-page screenshot. Look at each ` +
      `screenshot like a real visitor and combine it with the log.\n\n` +
      `Be STRICT: only report GENUINE defects a person must fix, such as: 404 / page not found, ` +
      `broken or missing images, blank or half-loaded sections, error text visible on the page, ` +
      `missing prices or add-to-cart buttons, broken/overlapping layout, or a product that clearly ` +
      `failed to render. Do NOT flag normal design choices, cosmetic preferences, marketing copy, or ` +
      `minor console warnings. If you are unsure whether something is a real defect, leave it out. ` +
      `If a page looks healthy, say so in one line.`,
  });

  for (const r of results) {
    parts.push({
      text:
        `\n=== ${r.label} — ${r.url} ===\n` +
        `HTTP status: ${r.httpStatus ?? "n/a"}\n` +
        `Page title: ${r.title || "(empty)"}\n` +
        `Load error: ${r.loadError || "none"}\n` +
        `Console errors: ${r.consoleErrors.length ? r.consoleErrors.join(" | ") : "none"}\n` +
        `Failed requests (>=400): ${r.failedRequests.length ? r.failedRequests.join(" | ") : "none"}\n` +
        `Broken images: ${r.brokenImages.length ? r.brokenImages.join(" | ") : "none"}\n` +
        `Screenshot:`,
    });

    if (r.screenshotB64) {
      parts.push({ inline_data: { mime_type: "image/png", data: r.screenshotB64 } });
    } else {
      parts.push({ text: "(screenshot unavailable)" });
    }
  }

  parts.push({
    text:
      `\nNow produce the daily report in EXACTLY this format (plain text, no markdown headers):\n\n` +
