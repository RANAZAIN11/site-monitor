// Sends screenshots + logs to Google Gemini (FREE tier). Gemini "looks" at each
// page screenshot and returns a short, human-readable report. Using Gemini means
// the whole thing runs free in the cloud even when your PC is off.

const MODEL = "gemini-2.0-flash"; // free tier. If you ever get a model error, try "gemini-1.5-flash"

export async function analyze(siteName, results) {
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

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=` +
    process.env.GEMINI_API_KEY;

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
