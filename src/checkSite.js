// Visits each page like a real visitor, SCROLLS through it so lazy-loaded images
// actually load, then collects front-end problems (console errors, failed
// requests, broken images, load failures) and a full-page screenshot that
// Gemini will actually look at.

import { chromium } from "playwright";
import sharp from "sharp";

async function autoScroll(page) {
  // Scroll to the bottom in small steps so lazy-loaded content triggers.
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        total += step;
        if (total >= document.body.scrollHeight - window.innerHeight - 50) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  await page.waitForTimeout(2000); // let lazy images finish downloading
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

export async function checkSite(config) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const results = [];

  for (const pageDef of config.pages) {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        "Mozilla/5.0 (SiteMonitorBot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 400) failedRequests.push(`${status} ${res.url().slice(0, 200)}`);
    });

    let httpStatus = null;
    let loadError = null;
    try {
      const resp = await page.goto(pageDef.url, {
        waitUntil: "networkidle",
        timeout: config.timeoutMs || 45000,
      });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(1500);
      await autoScroll(page); // <-- trigger lazy-loaded images
    } catch (err) {
      loadError = err.message;
    }

    let brokenImages = [];
    try {
      brokenImages = await page.evaluate(() =>
        Array.from(document.images)
          .filter((img) => img.complete && img.naturalWidth === 0)
          .map((img) => img.currentSrc || img.src)
          .slice(0, 20)
      );
    } catch {}

    let title = "";
    try {
      title = await page.title();
    } catch {}

    let screenshotB64 = null;
    try {
      const raw = await page.screenshot({ fullPage: true });
      const resized = await sharp(raw)
        .resize({
          width: config.maxImageEdgePx || 1568,
          height: config.maxImageEdgePx || 1568,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      screenshotB64 = resized.toString("base64");
    } catch (err) {
      loadError = loadError || `screenshot failed: ${err.message}`;
    }

    results.push({
      label: pageDef.label,
      url: pageDef.url,
      httpStatus,
      title,
      loadError,
      consoleErrors: consoleErrors.slice(0, 15),
      failedRequests: failedRequests.slice(0, 15),
      brokenImages,
      screenshotB64,
    });

    console.log(
      `  \u2713 ${pageDef.label}: HTTP ${httpStatus ?? "?"}, ` +
        `${consoleErrors.length} console errs, ${failedRequests.length} failed reqs, ` +
        `${brokenImages.length} broken imgs${loadError ? ", LOAD ERROR" : ""}`
    );

    await context.close();
  }

  await browser.close();
  return results;
}
