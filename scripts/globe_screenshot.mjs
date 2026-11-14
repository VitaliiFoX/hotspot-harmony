// Screenshot the page with the globe fully drawn: headless Chrome driven over the DevTools protocol in real time.
// (`--screenshot --virtual-time-budget` draws the imagery but not the vector, night or hotspot layers.)
//
// Usage: node scripts/globe_screenshot.mjs <url> <out.png> [zoom-in clicks] [wait ms] [JS to run before the shot]
// e.g.   node scripts/globe_screenshot.mjs "http://localhost:5173/?theme=dark" out.png 0 12000 \
//          "window.__hhMap.jumpTo({center:[30.52,50.45], zoom:12})"
// window.__hhMap is the MapLibre map, exposed by the dev server only. Needs Google Chrome and Node 22+.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, out, clicks = "0", waitMs = "12000", flyTo = ""] = process.argv.slice(2);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9333", "--window-size=1440,900", "--hide-scrollbars",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + m.params.exceptionDetails.exception?.description);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url });
await sleep(Number(waitMs));
for (let i = 0; i < Number(clicks); i++) {
  await send("Runtime.evaluate", { expression: "document.querySelector('.maplibregl-ctrl-zoom-in').click()" });
  await sleep(700);
}
if (flyTo) await send("Runtime.evaluate", { expression: flyTo });
await sleep(Number(clicks) ? 8000 : 1000);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log(logs.filter((l) => !/vite|DevTools/.test(l)).slice(0, 10).join("\n") || "no console errors");
chrome.kill(); process.exit(0);
