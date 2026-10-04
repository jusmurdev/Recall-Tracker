// Static server with SPA fallback for the Expo web export.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = process.argv[2];
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(root, decodeURIComponent(url.pathname));
  try {
    const st = await stat(file);
    if (st.isDirectory()) throw new Error("dir");
  } catch {
    file = path.join(root, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(8080, () => console.log("serving on 8080"));
