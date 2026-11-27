import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(projectRoot, "target/consumer-audit");
const chromium = process.env.CHROMIUM ?? "chromium";
const pages = [
  ["hello.html", "Hello, world!"],
  ["counter.html", "Counter"],
  ["conditional.html", "Conditional Playground"],
  ["todo.html", "Todo Application"],
  ["reorderable.html", "Reorderable List"],
];

const requestPage = (url) => new Promise((resolvePromise, reject) => {
  const req = request(url, (response) => { response.resume(); response.once("end", () => resolvePromise(response.statusCode)); });
  req.once("error", reject); req.end();
});
const freePort = () => new Promise((resolvePromise, reject) => {
  const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePromise(port)); });
});
const waitHttp = async (port) => { for (let i = 0; i < 150; i += 1) { try { if ((await requestPage(`http://127.0.0.1:${port}/`)) < 500) return; } catch {} await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); } throw new Error("preview timeout"); };
const waitTarget = async (port) => { for (let i = 0; i < 150; i += 1) { try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets[0]?.webSocketDebuggerUrl) return targets[0].webSocketDebuggerUrl; } catch {} await new Promise((resolvePromise) => setTimeout(resolvePromise, 100)); } throw new Error("Chromium target timeout"); };
async function command(ws, method, params = {}) { const socket = new WebSocket(ws); await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); }); const result = await new Promise((resolvePromise, reject) => { const id = 1; const listener = (event) => { const message = JSON.parse(event.data); if (message.id !== id) return; socket.removeEventListener("message", listener); message.error ? reject(new Error(JSON.stringify(message.error))) : resolvePromise(message.result); }; socket.addEventListener("message", listener); socket.send(JSON.stringify({ id, method, params })); }); socket.close(); return result; }
async function evaluate(ws, expression) { const result = await command(ws, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "browser evaluation failed"); return result.result.value; }
const stop = async (child) => { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise((resolvePromise) => child.once("exit", resolvePromise)); };

const preview = spawn(process.execPath, [resolve(projectRoot, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { cwd: projectRoot, stdio: "ignore" });
let browser;
let profile;
try {
  await waitHttp(4173);
  const debugPort = await freePort();
  profile = await mkdtemp(resolve(tmpdir(), "ruseact-a11y-chromium-"));
  browser = spawn(chromium, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--no-proxy-server", `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "http://127.0.0.1:4173/hello.html"], { cwd: projectRoot, stdio: "ignore" });
  const ws = await waitTarget(debugPort);
  const results = [];
  for (const [page, expected] of pages) {
    await evaluate(ws, `location.href = "http://127.0.0.1:4173/${page}?audit=1"; true`);
    for (let i = 0; i < 150; i += 1) { const text = await evaluate(ws, "document.body?.innerText ?? ''"); if (text.includes(expected)) break; await new Promise((resolvePromise) => setTimeout(resolvePromise, 50)); }
    const audit = await evaluate(ws, `(() => {
      const formControls = [...document.querySelectorAll('input,select,textarea')];
      const labels = formControls.filter((control) => {
        if (control.closest('label')) return true;
        const id = control.getAttribute('id');
        return Boolean(id && document.querySelector('label[for="' + CSS.escape(id) + '"]'));
      }).length;
      const buttons = [...document.querySelectorAll('button')];
      const namedButtons = buttons.filter((button) => (button.textContent ?? '').trim() || button.getAttribute('aria-label')).length;
      const focusTarget = document.querySelector('button,input');
      focusTarget?.focus();
      const style = focusTarget ? getComputedStyle(focusTarget) : null;
      return { formControlCount: formControls.length, labeledFormControls: labels, allFormControlsLabeled: labels === formControls.length, buttonCount: buttons.length, namedButtons, allButtonsNamed: namedButtons === buttons.length, hasMain: Boolean(document.querySelector('main')), focusIndicator: style ? { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow } : null };
    })()`);
    results.push({ page, ...audit });
  }
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "accessibility-results.json"), `${JSON.stringify({ schemaVersion: 1, browser: "Chromium 154.0.8037.57", results }, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  await stop(browser); await stop(preview); if (profile) await rm(profile, { recursive: true, force: true });
}
