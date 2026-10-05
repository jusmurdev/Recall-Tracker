// Regression screenshots for text fields at three effective font scales.
// Android font scale enlarges text relative to the screen; a narrower viewport with the same
// text sizes is the web equivalent. 360 dp is a 1080x2340 phone at 1.0x; 277 dp ≈ 1.3x; 225 dp ≈ 1.6x.
// Usage: node scripts/screenshots-inputs.mjs <outDir>   (API on :4000 seeded, web export on :8080)
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdir } from "node:fs/promises";
const out = process.argv[2];
await mkdir(out, { recursive: true });
const token = "demo-token-for-screenshots";
const SCALES = [["1.0", 360], ["1.3", 277], ["1.6", 225]];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium/chrome-linux/chrome" }).catch(() => chromium.launch());
const problems = [];
for (const [scale, width] of SCALES) {
  const context = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", timezoneId: "America/Los_Angeles" });
  await context.addInitScript((t) => { try { localStorage.setItem("recall.token", t); localStorage.setItem("recall.installId", "demo-install"); } catch {} }, token);
  const page = await context.newPage();
  const go = async (route) => { await page.goto(`http://localhost:8080${route}`, { waitUntil: "networkidle", timeout: 30000 }); await page.waitForTimeout(1200); };
  // A placeholder clips when its rendered text is wider than the box or the box is shorter than a line.
  const audit = async (screen) => {
    const found = await page.$$eval("input, textarea", (els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        const c = document.createElement("canvas").getContext("2d");
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = el.value || el.placeholder || "";
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
        const inner = el.getBoundingClientRect().width - pad;
        const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const innerH = el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        // Also catch a field (or the button beside it) pushed past the screen edge.
        const row = el.parentElement;
        const rowRight = row ? Math.max(...[...row.children].map((n) => n.getBoundingClientRect().right)) : el.getBoundingClientRect().right;
        const offscreen = Math.max(el.getBoundingClientRect().right, rowRight) > window.innerWidth - 8;
        return { tag: el.tagName, text, overflow: el.tagName === "INPUT" && c.measureText(text).width > inner + 1, short: innerH + 1 < lineH, offscreen };
      }),
    );
    for (const f of found) if (f.overflow || f.short || f.offscreen) problems.push(`${scale}x ${screen}: "${f.text}" ${f.overflow ? "wider than field" : ""}${f.short ? " shorter than one line" : ""}${f.offscreen ? " runs past the screen edge" : ""}`);
  };
  try {
    await go("/settings");
    const box = page.getByPlaceholder("Other allergen");
    await box.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await audit("settings");
    await page.screenshot({ path: `${out}/inputs-settings-${scale}.png` });
    await box.fill("lupin");
    await audit("settings (typed)");
    await page.screenshot({ path: `${out}/inputs-settings-typed-${scale}.png` });
  } catch (e) { problems.push(`${scale}x settings: ${e.message.split("\n")[0]}`); }
  for (const [name, route] of [["browse", "/browse"], ["watch-new", "/watch/new"], ["restaurant", "/watch/restaurant"]]) {
    try { await go(route); await audit(name); await page.screenshot({ path: `${out}/inputs-${name}-${scale}.png` }); } catch (e) { problems.push(`${scale}x ${name}: ${e.message.split("\n")[0]}`); }
  }
  try {
    await go("/scan");
    const typeIn = page.getByText("Type it in instead").first();
    if (await typeIn.isVisible().catch(() => false)) await typeIn.click();
    await page.waitForTimeout(400);
    await audit("scan product");
    await page.screenshot({ path: `${out}/inputs-scan-product-${scale}.png` });
    await page.getByText("Receipt", { exact: true }).first().click();
    await page.waitForTimeout(400);
    await audit("scan receipt");
    // The product/receipt switch must fit on the screen too.
    const seg = await page.getByText("Receipt", { exact: true }).first().boundingBox();
    if (seg && seg.x + seg.width > width - 4) problems.push(`${scale}x scan: product/receipt switch runs past the screen edge`);
    await page.screenshot({ path: `${out}/inputs-scan-receipt-${scale}.png` });
  } catch (e) { problems.push(`${scale}x scan: ${e.message.split("\n")[0]}`); }
  await context.close();
}
await browser.close();
console.log(problems.length ? `PROBLEMS\n${problems.join("\n")}` : "all inputs fit at 1.0x, 1.3x and 1.6x");
process.exit(problems.length ? 1 : 0);
