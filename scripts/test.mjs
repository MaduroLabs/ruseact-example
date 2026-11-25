import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const chromium = process.env.CHROMIUM ?? "chromium";

function waitForHttpPort(port, timeout = 15_000) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      httpGet(`http://127.0.0.1:${port}/`).then((status) => {
        if (status && status >= 200 && status < 500) resolvePromise();
        else throw new Error(`unexpected HTTP status ${status}`);
      }).catch(() => {
        if (Date.now() - started > timeout) reject(new Error(`Timed out waiting for HTTP port ${port}`));
        else setTimeout(poll, 100);
      });
    };
    poll();
  });
}

function httpGet(url) {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode));
    });
    req.once("error", reject);
    req.end();
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
  throw new Error("Timed out waiting for Chromium DevTools target");
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const result = await new Promise((resolvePromise, reject) => {
    const id = nextId++;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolvePromise(message.result?.result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.close();
  return result;
}

async function waitForPage(webSocketUrl, expectedText) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const state = await evaluate(webSocketUrl, `({
      ready: document.readyState,
      text: document.body?.innerText ?? "",
      url: location.href,
    })`);
    if (state?.text?.includes(expectedText) || state?.text?.includes("Application failed")) return state;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const finalState = await evaluate(webSocketUrl, `({
    ready: document.readyState,
    text: document.body?.innerText ?? "",
    url: location.href,
    html: document.body?.innerHTML ?? "",
  })`);
  throw new Error(`Timed out waiting for ${expectedText}: ${JSON.stringify(finalState)}`);
}

function start(command, args) {
  return spawn(command, args, { cwd: root, stdio: "ignore" });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolvePromise) => child.once("exit", resolvePromise));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000))]);
}

const preview = start(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"]);
let browser;
let profile;
try {
  await waitForHttpPort(4173);
  const debugPort = await findFreePort();
  profile = await mkdtemp(resolve(tmpdir(), "ruseact-example-chromium-"));
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
    "http://127.0.0.1:4173/hello.html",
  ]);
  const webSocketUrl = await waitForTarget(debugPort);
  await waitForPage(webSocketUrl, "Hello, world!");
  const hello = await evaluate(webSocketUrl, `(() => ({
    title: document.title,
    text: document.body.innerText,
    error: document.querySelector('[data-state="error"]')?.textContent ?? null,
  }))()`);
  if (!hello.text.includes("Hello, world!") || hello.error) throw new Error(`Hello World verification failed: ${JSON.stringify(hello)}`);

  const navigate = await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/counter.html?test=1"; true`);
  if (!navigate) throw new Error("Counter navigation did not start");
  const counterPage = await waitForPage(webSocketUrl, "Counter");
  if (!counterPage.text.includes("Counter")) throw new Error(`Counter mount failed: ${JSON.stringify(counterPage)}`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  const counter = await evaluate(webSocketUrl, `(() => ({
    initial: document.querySelector('output')?.textContent?.trim(),
    beforeFlush: (() => {
      window.__ruseactCounterTest.setWithoutFlush(7);
      return document.querySelector('output')?.textContent?.trim();
    })(),
    afterFlush: (() => {
      window.__ruseactCounterTest.flush();
      return document.querySelector('output')?.textContent?.trim();
    })(),
  }))()`);
  if (counter.initial !== "0" || counter.beforeFlush !== "0" || counter.afterFlush !== "7") {
    throw new Error(`Counter manual flush verification failed: ${JSON.stringify(counter)}`);
  }
  const clicks = await evaluate(webSocketUrl, `(() => {
    const output = document.querySelector('output');
    const before = output;
    document.querySelector('button:nth-of-type(2)').click();
    const incremented = output?.textContent?.trim();
    document.querySelector('button:nth-of-type(1)').click();
    const decremented = output?.textContent?.trim();
    document.querySelector('button:nth-of-type(3)').click();
    return { incremented, decremented, reset: output?.textContent?.trim(), sameNode: before === output };
  })()`);
  if (clicks.incremented !== "8" || clicks.decremented !== "7" || clicks.reset !== "0" || !clicks.sameNode) {
    throw new Error(`Counter interaction verification failed: ${JSON.stringify(clicks)}`);
  }
  console.log("Real Chromium consumer verification passed for Hello World, Counter, explicit flush, and DOM identity.");
} finally {
  await stopProcess(browser);
  await stopProcess(preview);
  if (profile) await rm(profile, { recursive: true, force: true });
}
