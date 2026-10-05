// Screenshots for the dietary-profile screens. Usage: node scripts/screenshots-diet.mjs <outDir>
// Needs the API on :4000 (seeded with seed:demo) and the web export served on :8080.
import pw from "/opt/node-tools/node_modules/playwright/index.js";
const { chromium, devices } = pw;
import { mkdir } from "node:fs/promises";
const out = process.argv[2];
const token = "demo-token-for-screenshots";
const api = "http://localhost:4000";
await mkdir(out, { recursive: true });
const h = { authorization: `Bearer ${token}` };
const alerts = await (await fetch(`${api}/v1/alerts`, { headers: h })).json();
const dietAlert = alerts.items.find((a) => a.reason === "diet_match" && a.dietKind === "undeclared" && a.dietProfile === "allergy_peanut") ?? alerts.items.find((a) => a.reason === "diet_match");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium/chrome-linux/chrome" }).catch(() => chromium.launch());
const iphone = devices["iPhone 14"];
const context = await browser.newContext({ ...iphone, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light", locale: "en-US", timezoneId: "America/Los_Angeles", permissions: [] });
await context.addInitScript((t) => {
  try { localStorage.setItem("recall.token", t); localStorage.setItem("recall.installId", "demo-install"); } catch {}
}, token);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
const go = async (route) => { await page.goto(`http://localhost:8080${route}`, { waitUntil: "networkidle", timeout: 30000 }); await page.waitForTimeout(1500); };
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: false }).then(() => console.log("ok", name));

try { await go("/"); await shot("20-home-diet-lead"); } catch (e) { console.log("FAIL home", e.message.split("\n")[0]); }
try {
  await go("/settings");
  await page.getByText("Diet and allergies").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("21-settings-diet");
} catch (e) { console.log("FAIL settings", e.message.split("\n")[0]); }
try {
  await go("/browse");
  await page.getByText("For my diet").first().click();
  await page.waitForTimeout(1800);
  await shot("22-browse-for-my-diet");
} catch (e) { console.log("FAIL browse", e.message.split("\n")[0]); }
try { if (dietAlert) { await go(`/alert/${dietAlert.id}`); await shot("23-alert-diet-detail"); } } catch (e) { console.log("FAIL alert", e.message.split("\n")[0]); }
try { await go("/diet-info"); await shot("24-about-diet-alerts"); } catch (e) { console.log("FAIL info", e.message.split("\n")[0]); }
try {
  await go("/scan");
  const typeIn = page.getByText("Type it in instead").first();
  if (await typeIn.isVisible().catch(() => false)) await typeIn.click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder("Product name").fill("Zappo Crunch Bar\nINGREDIENTS: SUGAR, RICE, CASEIN, PORK GELATIN, MUSTARD FLOUR");
  await page.getByText("Check it").first().click();
  await page.waitForTimeout(2500);
  await shot("25-scan-diet-heads-up");
} catch (e) { console.log("FAIL scan", e.message.split("\n")[0]); }
if (errors.length) console.log("page errors:\n" + [...new Set(errors)].slice(0, 10).join("\n"));
await browser.close();
