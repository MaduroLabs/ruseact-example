import { mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = resolve(projectRoot, "target/consumer-audit");
const chromium = process.env.CHROMIUM ?? "chromium";
const chromiumVersion = execFileSync(chromium, ["--version"], { encoding: "utf8" }).trim();
const configuration = {
  warmupSamples: 1,
  samples: 5,
  independentRuns: 3,
  listSizes: [10, 100],
  timer: "performance.now() inside the production preview page",
  executionMode: "Chromium headless=new, one fresh profile per independent run",
};

function start(command, args) {
  return spawn(command, args, { cwd: projectRoot, stdio: "ignore" });
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

async function waitForHttpPort(port) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const status = await httpGet(`http://127.0.0.1:${port}/`);
      if (status >= 200 && status < 500) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for preview port ${port}`);
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

async function waitForText(webSocketUrl, text) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const state = await evaluate(webSocketUrl, `({ text: document.body?.innerText ?? "", error: document.querySelector('[data-state="error"]')?.textContent ?? null })`);
    if (state.text.includes(text) || state.error) {
      if (state.error) throw new Error(state.error);
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`timed out waiting for ${text}`);
}

function startBrowser(debugPort, profile, url) {
  return start(chromium, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-proxy-server",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    url,
  ]);
}

function navigateExpression(path, expected) {
  return async (webSocketUrl) => {
    await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/${path}?test=1&benchmark=1&sample=${Date.now()}"; true`);
    await waitForText(webSocketUrl, expected);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.durationMs);
  const med = median(durations);
  const q1 = percentile(durations, 0.25);
  const q3 = percentile(durations, 0.75);
  const valid = samples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs > 0 && sample.correctness === true);
  return {
    sampleCount: samples.length,
    medianMs: med,
    iqrMs: q3 - q1,
    dispersionRatio: med > 0 ? (q3 - q1) / med : null,
    measurementStatus: valid ? ((q3 - q1) / med > 0.75 ? "high_variability" : "valid") : "unresolved",
  };
}

const timed = (body, correctness, operationCount, flushCalls) => `(() => {
  const start = performance.now();
  ${body}
  const durationMs = performance.now() - start;
  return { durationMs, operationCount: ${operationCount}, flushCalls: ${flushCalls}, correctness: Boolean(${correctness}) };
})()`;

const todoPrepare = (size, completed = false) => `(() => {
  const app = window.__ruseactTodoTest;
  while (app.getSnapshot().todos.length < ${size}) app.add("Benchmark task");
  ${completed ? `for (const todo of app.getSnapshot().todos.filter((item) => item.id % 2 === 0)) app.toggleWithoutFlush(todo.id); app.flush(); app.flush();` : ""}
  return true;
})()`;
const reorderPrepare = (size) => `(() => {
  const app = window.__ruseactReorderableTest;
  while (app.getSnapshot().items.length < ${size}) app.append("Benchmark item");
  return true;
})()`;

const workloads = [
  { id: "counter.scalar-update-flush", path: "counter.html", expected: "Counter", prepare: "", operation: timed("const app = window.__ruseactCounterTest; app.setWithoutFlush(1); app.flush();", "document.querySelector('output')?.textContent?.trim() === '1'", 1, 1) },
  { id: "counter.repeated-scalar-updates", path: "counter.html", expected: "Counter", prepare: "", operation: timed("const app = window.__ruseactCounterTest; for (let index = 0; index < 20; index += 1) { app.setWithoutFlush(index + 1); app.flush(); }", "document.querySelector('output')?.textContent?.trim() === '20'", 20, 20) },
  { id: "counter.multiple-writes-one-flush", path: "counter.html", expected: "Counter", prepare: "", operation: timed("const app = window.__ruseactCounterTest; app.setWithoutFlush(1); app.setWithoutFlush(2); app.setWithoutFlush(3); app.flush();", "document.querySelector('output')?.textContent?.trim() === '3'", 3, 1) },
  { id: "counter.equality-write", path: "counter.html", expected: "Counter", prepare: "", operation: timed("const app = window.__ruseactCounterTest; app.setWithoutFlush(0); app.flush();", "document.querySelector('output')?.textContent?.trim() === '0'", 1, 1) },
  { id: "conditional.mount-branch", path: "conditional.html", expected: "Conditional Playground", prepare: "", operation: timed("const app = window.__ruseactConditionalTest; app.setPanelWithoutFlush(true); app.flush();", "document.querySelector('[data-testid=settings-panel]') !== null", 1, 1) },
  { id: "conditional.nested-activation", path: "conditional.html", expected: "Conditional Playground", prepare: "window.__ruseactConditionalTest.setPanelWithoutFlush(true); window.__ruseactConditionalTest.flush();", operation: timed("const app = window.__ruseactConditionalTest; app.setAdvancedWithoutFlush(true); app.flush();", "document.querySelector('[data-testid=advanced-content]') !== null", 1, 1) },
];

for (const size of configuration.listSizes) {
  workloads.push(
    { id: `todo.append-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size - 1), operation: timed("const app = window.__ruseactTodoTest; app.add('Measured append');", `window.__ruseactTodoTest.getSnapshot().todos.length === ${size}`, 1, 1) },
    { id: `todo.remove-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size), operation: timed("const app = window.__ruseactTodoTest; const id = app.getSnapshot().todos.at(-1).id; app.remove(id);", `window.__ruseactTodoTest.getSnapshot().todos.length === ${size - 1}`, 1, 1) },
    { id: `todo.toggle-retained-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size), operation: timed("const app = window.__ruseactTodoTest; app.toggleWithoutFlush(1); app.flush(); app.flush();", "window.__ruseactTodoTest.getSnapshot().todos.find((item) => item.id === 1)?.completed === true", 1, 2) },
    { id: `todo.filter-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size, true), operation: timed("const app = window.__ruseactTodoTest; app.setFilter('completed');", `window.__ruseactTodoTest.getSnapshot().visibleIds.length > 0 && window.__ruseactTodoTest.getSnapshot().visibleIds.length < ${size}`, 1, 1) },
    { id: `todo.reverse-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size), operation: timed("const app = window.__ruseactTodoTest; const before = app.getSnapshot().todos.map((item) => item.id); app.reverse();", "window.__ruseactTodoTest.getSnapshot().todos[0].id !== 1", 1, 1) },
    { id: `todo.edit-retained-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size), operation: timed("const app = window.__ruseactTodoTest; app.saveEdit(1, 'Measured edit');", "window.__ruseactTodoTest.getSnapshot().todos.find((item) => item.id === 1)?.title === 'Measured edit'", 1, 2) },
    { id: `todo.clear-completed-${size}`, path: "todo.html", expected: "Todo Application", prepare: todoPrepare(size, true), operation: timed("const app = window.__ruseactTodoTest; app.clearCompleted();", "window.__ruseactTodoTest.getSnapshot().todos.every((item) => !item.completed)", 1, 1) },
    { id: `reorderable.append-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; app.append('Measured append');", `window.__ruseactReorderableTest.getSnapshot().items.length === ${size + 1}`, 1, 1) },
    { id: `reorderable.prepend-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; app.prepend('Measured prepend');", `window.__ruseactReorderableTest.getSnapshot().items.length === ${size + 1}`, 1, 1) },
    { id: `reorderable.remove-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; const id = app.getSnapshot().items.at(-1).id; app.remove(id);", `window.__ruseactReorderableTest.getSnapshot().items.length === ${size - 1}`, 1, 1) },
    { id: `reorderable.reverse-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; app.reverse();", `window.__ruseactReorderableTest.getSnapshot().items[0].id === ${size} && window.__ruseactReorderableTest.getSnapshot().items.at(-1).id === 1`, 1, 1) },
    { id: `reorderable.shuffle-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; app.shuffle();", `window.__ruseactReorderableTest.getSnapshot().items.length === ${size}`, 1, 1) },
    { id: `reorderable.no-op-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; const id = app.getSnapshot().items[0].id; window.__ruseactAuditNoOp = app.moveUp(id);", `window.__ruseactAuditNoOp === false && window.__ruseactReorderableTest.getSnapshot().items.length === ${size}`, 1, 0) },
    { id: `reorderable.retained-title-${size}`, path: "reorderable.html", expected: "Reorderable List", prepare: reorderPrepare(size), operation: timed("const app = window.__ruseactReorderableTest; app.updateTitle(1);", "window.__ruseactReorderableTest.getSnapshot().items.find((item) => item.id === 1)?.title.includes('updated')", 1, 2) },
  );
}

const initialWorkloads = [
  { id: "hello.initial-mount", path: "hello.html", expected: "Hello, world!" },
  { id: "counter.initial-mount", path: "counter.html", expected: "Counter" },
  { id: "conditional.initial-mount", path: "conditional.html", expected: "Conditional Playground" },
  { id: "todo.initial-mount", path: "todo.html", expected: "Todo Application" },
  { id: "reorderable.initial-mount", path: "reorderable.html", expected: "Reorderable List" },
];

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => child.once("exit", resolvePromise));
}

async function removeProfile(profile) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" || attempt === 9) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
}

async function runIndependentRun(runIndex) {
  const debugPort = await findFreePort();
  const profile = await mkdtemp(resolve(tmpdir(), `ruseact-audit-chromium-${runIndex}-`));
  const browser = startBrowser(debugPort, profile, "http://127.0.0.1:4173/hello.html?test=1&benchmark=1");
  const webSocketUrl = await waitForTarget(debugPort);
  const results = [];
  try {
    for (const workload of initialWorkloads) {
      const samples = [];
      for (let index = 0; index < configuration.warmupSamples + configuration.samples; index += 1) {
        await navigateExpression(workload.path, workload.expected)(webSocketUrl);
        const mount = await evaluate(webSocketUrl, "window.__ruseactAuditMount");
        if (index >= configuration.warmupSamples) samples.push({ durationMs: mount.mountedAt - mount.startedAt, operationCount: 1, flushCalls: 0, correctness: true });
      }
      results.push({ id: workload.id, samples, summary: summarize(samples), boundary: "module script start through successful root.mount; excludes network fetch and browser paint" });
    }
    for (const workload of workloads) {
      const samples = [];
      for (let index = 0; index < configuration.warmupSamples + configuration.samples; index += 1) {
        await navigateExpression(workload.path, workload.expected)(webSocketUrl);
        if (workload.prepare) await evaluate(webSocketUrl, workload.prepare);
        const measured = await evaluate(webSocketUrl, workload.operation);
        if (index >= configuration.warmupSamples) samples.push(measured);
      }
      results.push({ id: workload.id, samples, summary: summarize(samples), boundary: "synchronous application operation through the explicit flush calls in the operation" });
    }
    return { runIndex, results };
  } finally {
    await stopProcess(browser);
    await removeProfile(profile);
  }
}

const preview = start(process.execPath, [resolve(projectRoot, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"]);
try {
  await waitForHttpPort(4173);
  const runs = [];
  for (let runIndex = 1; runIndex <= configuration.independentRuns; runIndex += 1) {
    console.log(`Starting independent benchmark run ${runIndex}/${configuration.independentRuns}...`);
    runs.push(await runIndependentRun(runIndex));
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: "MaduroLabs/ruseact-example",
    consumerCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(),
    artifactSourceCommit: "2a0ab7781b6c56fde643bf6bc8ed3f550097209c",
    packageVersion: "0.1.0-alpha.1",
    configuration,
    browser: { executable: chromium, version: chromiumVersion, execution: configuration.executionMode },
    workloads: [...initialWorkloads.map(({ id }) => id), ...workloads.map(({ id }) => id)],
    runs,
    integrity: { positiveFiniteSamplesRequired: true, correctnessRequired: true, dispersionIsReportedNotSilentlyAccepted: true },
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, "benchmark-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  const correctness = runs.flatMap((run) => run.results.map((row) => ({
    runIndex: run.runIndex,
    id: row.id,
    samples: row.samples.map((sample) => ({
      operationCount: sample.operationCount,
      flushCalls: sample.flushCalls,
      correctness: sample.correctness,
    })),
  })));
  await writeFile(resolve(outputRoot, "correctness-results.json"), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    consumerCommit: report.consumerCommit,
    artifactSourceCommit: report.artifactSourceCommit,
    packageVersion: report.packageVersion,
    allSamplesCorrect: correctness.every((row) => row.samples.every((sample) => sample.correctness)),
    results: correctness,
  }, null, 2)}\n`);
  const summary = runs.flatMap((run) => run.results).reduce((counts, row) => {
    counts[row.summary.measurementStatus] = (counts[row.summary.measurementStatus] ?? 0) + 1;
    return counts;
  }, {});
  await writeFile(resolve(outputRoot, "benchmark-summary.md"), `# Consumer benchmark summary\n\nGenerated ${report.generatedAt}.\n\n- Runs: ${runs.length}\n- Workload rows per run: ${runs[0].results.length}\n- Status counts across runs: ${JSON.stringify(summary)}\n- Raw samples: [benchmark-results.json](benchmark-results.json)\n`);
  await writeFile(resolve(outputRoot, "environment.json"), `${JSON.stringify({ repository: report.repository, consumerCommit: report.consumerCommit, artifactSourceCommit: report.artifactSourceCommit, packageVersion: report.packageVersion, node: process.version, pnpm: "12.16.1", typescript: "5.9.3", vite: "8.3.8", chromium: report.browser.version, os: process.platform, arch: process.arch, cpuCount: availableParallelism() }, null, 2)}\n`);
  console.log(JSON.stringify(summary));
} finally {
  await stopProcess(preview);
}
