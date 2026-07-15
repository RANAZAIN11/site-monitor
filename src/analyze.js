// Sends screenshots + logs to Google Gemini (FREE tier). Auto-detects an
// available Flash model for your API key, so it keeps working even if Google
// renames models. Optional: set a GEMINI_MODEL secret to force a specific model.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function pickModel(key) {
  if (process.env.GEMINI_MODEL) {
    return "models/" + process.env.GEMINI_MODEL.replace(/^models\//, "");
  }
  const resp = await fetch(`${API_BASE}/models?key=${key}`);
  if (!resp.ok) {
    throw new Error(`Could not list Gemini models (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const usable = (data.models || []).filter((m) =>
    (m.supportedGenerationMethods || []).includes("generateContent")
  );
  const flash =
    usable.find((m) => /flash/i.test(m.name) && !/vision|thinking|exp|preview/i.test(m.name)) ||
    usable.find((m) => /flash/i.test(m.name)) ||
    usable[0];
  if (!flash) throw new Error("No Gemini model with generateContent available for this key.");
  return flash.name; // e.g. "models/gemini-1.5-flash-latest"
}

export async function analyze(siteName, results) {
  const key = process.env.GEMINI_API_KEY;
  const model = await pickModel(key);
  console.log("Using Gemini model:", model);

  const parts = [];

  parts.push({
    text:
      `You are a QA assistant reviewing the front-end of the e-commerce site "${siteName}". ` +
      `For each page you get a technical log (HTTP status, console errors, failed network requests, ` +
      `broken image URLs) plus a full-page screenshot. Look at each screenshot like a real visitor ` +
      `and combine it with the log. Report ONLY things a human should act on: broken or missing ` +
      `products, blank / half-loaded sections, broken images, layout breakage, error messages visible ` +
      `on the page, missing prices or add-to-cart buttons, 404s, etc. If a page looks healthy, say so ` +
      `in one line.`,
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
      `\nNow produce the daily report in EXACTLY this format:\n\n` +
      `STATUS: <OK | ISSUES FOUND>\n\n` +
      `Then a short list, grouped per page. Prefix each issue with a severity tag ` +
      `[HIGH] / [MED] / [LOW]. End with one line "Action for team:" saying what to check or fix first. ` +
      `Keep the whole thing under 250 words. Plain text, no markdown headers.`,
  });

  const url = `${API_BASE}/${model}:generateContent?key=${key}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: 1500, temperature: 0.3 },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${t.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini returned no text. Raw: " + JSON.stringify(data).slice(0, 300));
  return text;
}
