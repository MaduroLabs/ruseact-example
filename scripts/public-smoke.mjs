import { readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const chromium = process.env.CHROMIUM ?? "chromium";
const pages = [
  ["/", "Ruseact"],
  ["/hello.html", "Hello, world!"],
  ["/counter.html", "Counter"],
  ["/conditional.html", "Conditional Playground"],
  ["/todo.html", "Todo Application"],
  ["/reorderable.html", "Reorderable List"],
];
const controlNames = [
  "__ruseactCounterTest",
  "__ruseactConditionalTest",
  "__ruseactTodoTest",
  "__ruseactReorderableTest",
  "__ruseactAuditMount",
];

function start(command, args) {
  return spawn(command, args, { cwd: projectRoot, stdio: "ignore" });
}

function waitForHttpPort(port) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      const req = request(`http://127.0.0.1:${port}/`, (response) => {
        response.resume();
        response.once("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 500) resolvePromise();
          else reject(new Error(`unexpected preview status ${response.statusCode}`));
        });
      });
      req.once("error", () => {
        if (Date.now() - started > 15_000) reject(new Error(`timed out waiting for HTTP port ${port}`));
        else setTimeout(poll, 100);
      });
      req.end();
    };
    poll();
  });
}

function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

async function waitForTarget(debugPort) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page");
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("timed out waiting for Chromium DevTools target");
}

async function sendCommand(webSocketUrl, method, params = {}) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const result = await new Promise((resolvePromise, reject) => {
    const id = 1;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolvePromise(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.close();
  return result;
}

async function evaluate(webSocketUrl, expression) {
  const result = await sendCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "browser evaluation failed");
  }
  return result?.result?.value;
}

async function waitForText(webSocketUrl, expected) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const state = await evaluate(webSocketUrl, "({ text: document.body?.innerText ?? '', errors: window.__publicSmokeErrors ?? [] })");
    if (state.errors.length > 0) throw new Error(`public page error: ${state.errors.join(" | ")}`);
    if (state.text.includes(expected)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`timed out waiting for ${expected}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

const publicAssets = [];
for (const file of ["dist/index.html", ...pages.slice(1).map(([path]) => `dist${path}`)]) {
  publicAssets.push(await readFile(resolve(projectRoot, file), "utf8"));
}
const assetFiles = (await import("node:fs/promises")).readdir(resolve(projectRoot, "dist/assets"));
for (const file of await assetFiles) {
  if (file.endsWith(".js")) publicAssets.push(await readFile(resolve(projectRoot, "dist/assets", file), "utf8"));
}
const forbiddenTokens = [...controlNames, "RUSEACT_INSTRUMENTED"];
for (const token of forbiddenTokens) {
  if (publicAssets.some((asset) => asset.includes(token))) throw new Error(`public bundle contains forbidden instrumentation token ${token}`);
}

const preview = start(process.execPath, [resolve(projectRoot, "node_modules/vite/bin/vite.js"), "preview", "--outDir", "dist", "--host", "127.0.0.1", "--port", "4173", "--strictPort"]);
let browser;
let profile;
try {
  await waitForHttpPort(4173);
  const debugPort = await findFreePort();
  profile = await mkdtemp(resolve(tmpdir(), "ruseact-public-smoke-"));
  browser = start(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "http://127.0.0.1:4173/",
  ]);
  const webSocketUrl = await waitForTarget(debugPort);
  await sendCommand(webSocketUrl, "Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__publicSmokeErrors = []; window.addEventListener('error', (event) => window.__publicSmokeErrors.push(event.error?.stack || event.message)); window.addEventListener('unhandledrejection', (event) => window.__publicSmokeErrors.push(String(event.reason)));",
  });

  for (const [path, expected] of pages) {
    await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173${path}?test=1&benchmark=1&public-smoke=1"; true`);
    await waitForText(webSocketUrl, expected);
    const result = await evaluate(webSocketUrl, `(() => {
      const forbidden = ${JSON.stringify(controlNames)}.filter((name) => Object.prototype.hasOwnProperty.call(window, name) && window[name] !== undefined);
      const failedAssets = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/assets/')).filter((entry) => entry.responseStatus >= 400).map((entry) => entry.name);
      return { url: location.pathname, forbidden, failedAssets, hasMain: Boolean(document.querySelector('main')), errors: window.__publicSmokeErrors ?? [] };
    })()`);
    if (result.forbidden.length > 0 || result.failedAssets.length > 0 || result.errors.length > 0 || !result.hasMain) {
      throw new Error(`public smoke isolation failed: ${JSON.stringify(result)}`);
    }

    if (path === "/counter.html") {
      await evaluate(webSocketUrl, "document.querySelector('button:nth-of-type(2)')?.click(); true");
      const value = await evaluate(webSocketUrl, "document.querySelector('output')?.textContent?.trim()");
      if (value !== "1") throw new Error(`public counter interaction failed: ${value}`);
    } else if (path === "/conditional.html") {
      await evaluate(webSocketUrl, "document.querySelector('[data-testid=panel-toggle]')?.click(); true");
      const mounted = await evaluate(webSocketUrl, "Boolean(document.querySelector('[data-testid=settings-panel]'))");
      if (!mounted) throw new Error("public conditional interaction failed");
    } else if (path === "/todo.html") {
      await evaluate(webSocketUrl, "(() => { const input = document.querySelector('[data-testid=todo-input]'); input.value = 'Public smoke task'; document.querySelector('[data-testid=todo-add]')?.click(); return true; })()");
      const added = await evaluate(webSocketUrl, "Boolean([...document.querySelectorAll('[data-testid=todo-item]')].find((item) => item.textContent.includes('Public smoke task')))");
      if (!added) throw new Error("public Todo interaction failed");
    } else if (path === "/reorderable.html") {
      const moved = await evaluate(webSocketUrl, `(() => { const item = document.querySelector('[data-testid="reorder-item"][data-task-key="1"]'); item?.querySelector('[data-testid="reorder-down"]')?.click(); return document.querySelector('[data-testid="reorder-item"][data-task-key="2"]')?.getAttribute('data-task-key') === '2'; })()`);
      if (!moved) throw new Error("public reorderable interaction failed");
    }
  }
  console.log("Public Chromium smoke passed: landing page, five examples, packaged WASM, user controls, query isolation, assets, and runtime errors.");
} finally {
  await stop(browser);
  await stop(preview);
  if (profile) await rm(profile, { recursive: true, force: true });
}
