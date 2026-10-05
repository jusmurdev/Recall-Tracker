import pw from "playwright";
import { mkdir } from "node:fs/promises";
const { chromium, devices } = pw;
const out = process.argv[2];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 14"], deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light", locale: "en-US", timezoneId: "America/Los_Angeles" });
await context.addInitScript(() => { try { localStorage.setItem("recall.token", "demo-token-for-screenshots"); localStorage.setItem("recall.installId", "demo-install"); } catch {} });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto("http://localhost:8080/scan", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("03a-scan-start");

// Product: type it in, check
await page.getByPlaceholder(/Brand and product/).fill("Jif creamy peanut butter");
await page.getByRole("button", { name: "Check it" }).click();
await page.waitForTimeout(2000);
await shot("03b-scan-product-result");

// Back, switch to receipt
await page.getByRole("button", { name: "Scan another" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Check a receipt" }).click();
await page.waitForTimeout(400);
await shot("03c-scan-receipt-start");
await page.getByPlaceholder(/One item per line/).fill("KROGER\n10/02/2026\nJIF CRMY PNT BTR 16Z 3.49 F\nBOARS HEAD LVRWRST 6.99 F\nBNNA ORG 2.58 F\nKRGR WHL MLK GAL 3.19 F\nSTANLEY TRVL MUG 12OZ 24.99 T\nSUBTOTAL 41.24");
await page.getByRole("button", { name: "Check it" }).click();
await page.waitForTimeout(2500);
await shot("03d-scan-receipt-result");
await page.mouse.wheel(0, 700);
await page.waitForTimeout(500);
await shot("03e-scan-receipt-result-2");

await page.goto("http://localhost:8080/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("01-home");
console.log("errors:", errors.join("\n") || "none");
await browser.close();
