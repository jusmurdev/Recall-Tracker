import pw from "playwright";
const { chromium, devices } = pw;
import { mkdir } from "node:fs/promises";
const out = process.argv[2];
const token = "demo-token-for-screenshots";
const api = "http://localhost:4000";
await mkdir(out, { recursive: true });

const me = await (await fetch(`${api}/v1/watchlist`, { headers: { authorization: `Bearer ${token}` } })).json();
const restaurant = me.items.find((w) => w.kind === "restaurant");
const alerts = await (await fetch(`${api}/v1/alerts`, { headers: { authorization: `Bearer ${token}` } })).json();
const recalls = await (await fetch(`${api}/v1/recalls?q=jif`)).json();
const jif = recalls.items[0];
const topAlert = alerts.items[0];

const routes = [
  ["01-recalls-feed", "/"],
  ["02-recall-detail", `/recall/${jif.id}`],
  ["03-scan", "/scan"],
  ["04-watchlist", "/watchlist"],
  ["05-watch-new", "/watch/new"],
  ["06-subscribe", "/watch/subscribe"],
  ["07-restaurant-detail", `/watch/${restaurant.id}`],
  ["08-restaurant-add", "/watch/restaurant"],
  ["09-alerts", "/alerts"],
  ["10-alert-detail", `/alert/${topAlert.id}`],
  ["11-restaurant-updates", "/restaurant-updates"],
  ["12-premium", "/premium"],
  ["13-connectors", "/premium/connectors"],
  ["14-settings", "/settings"],
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium/chrome-linux/chrome" }).catch(() => chromium.launch());
const iphone = devices["iPhone 14"];
const context = await browser.newContext({ ...iphone, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "en-US", timezoneId: "America/Los_Angeles", permissions: [] });
await context.addInitScript((t) => {
  try { localStorage.setItem("recall.token", t); localStorage.setItem("recall.installId", "demo-install"); } catch {}
}, token);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });

for (const [name, route] of routes) {
  try {
    await page.goto(`http://localhost:8080${route}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
    console.log("ok", name);
  } catch (e) {
    console.log("FAIL", name, e.message.split("\n")[0]);
  }
}
// Interaction: search the catalog in the restaurant form
try {
  await page.goto("http://localhost:8080/watch/restaurant", { waitUntil: "networkidle" });
  await page.getByPlaceholder("Restaurant name").fill("capitol");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/08b-restaurant-catalog-search.png` });
  console.log("ok 08b");
} catch (e) { console.log("FAIL 08b", e.message.split("\n")[0]); }
// Interaction: type a product into the feed search
try {
  await page.goto("http://localhost:8080/", { waitUntil: "networkidle" });
  await page.getByPlaceholder(/Search recalls/).fill("listeria");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/01b-feed-search.png` });
  console.log("ok 01b");
} catch (e) { console.log("FAIL 01b", e.message.split("\n")[0]); }
console.log("errors:", [...new Set(errors)].slice(0, 15).join("\n") || "none");
await browser.close();
