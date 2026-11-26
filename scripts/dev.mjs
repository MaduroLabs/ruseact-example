import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const run = (script) => new Promise((resolvePromise, reject) => {
  const child = spawn(node, [resolve(projectRoot, script)], { cwd: projectRoot, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${script} exited with ${code}`)));
});

await run("scripts/verify-artifacts.mjs");
await run("scripts/precompile.mjs");

const vite = spawn(node, [resolve(projectRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], {
  cwd: projectRoot,
  stdio: "inherit",
});
let compiling = false;
let queued = false;
let timer;
const compile = async () => {
  if (compiling) {
    queued = true;
    return;
  }
  compiling = true;
  try {
    await run("scripts/precompile.mjs");
  } catch (error) {
    console.error(error);
  } finally {
    compiling = false;
    if (queued) {
      queued = false;
      void compile();
    }
  }
};
const scheduleCompile = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void compile(), 100);
};
const watchers = [
  watch(resolve(projectRoot, "src/examples/hello-world"), scheduleCompile),
  watch(resolve(projectRoot, "src/examples/counter"), scheduleCompile),
  watch(resolve(projectRoot, "src/examples/conditional"), scheduleCompile),
  watch(resolve(projectRoot, "src/examples/todo"), scheduleCompile),
];

const shutdown = () => {
  for (const watcher of watchers) watcher.close();
  vite.kill("SIGTERM");
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
vite.once("exit", (code) => {
  for (const watcher of watchers) watcher.close();
  process.exit(code ?? 0);
});
