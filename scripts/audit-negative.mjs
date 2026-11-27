import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as wasm from "ruseact/wasm/node";
import { createReactiveCore } from "ruseact";
import { createRoot } from "ruseact-dom";
import { compileTsxModule } from "ruseact-compiler";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = resolve(projectRoot, "artifacts/ruseact/0.1.0-alpha.1");
const outputRoot = resolve(projectRoot, "target/consumer-audit");

function compilerProbe(name, source) {
  const result = compileTsxModule(source, { fileName: `audit/${name}.tsx` });
  if (result.ok) return { name, ok: true, diagnostics: [] };
  return {
    name,
    ok: false,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      location: diagnostic.location,
    })),
  };
}

function run(command, args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolvePromise({ exitCode: null, stdout, stderr: String(error) }));
    child.once("exit", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

async function verifierFailure(kind, mutate) {
  const tempRoot = await mkdtemp(resolve("/tmp", "ruseact-negative-"));
  const tempArtifacts = resolve(tempRoot, "artifacts/ruseact/0.1.0-alpha.1");
  await mkdir(tempArtifacts, { recursive: true });
  await mkdir(resolve(tempRoot, "scripts"), { recursive: true });
  await cp(artifactRoot, tempArtifacts, { recursive: true });
  await cp(resolve(projectRoot, "scripts/verify-artifacts.mjs"), resolve(tempRoot, "scripts/verify-artifacts.mjs"), { recursive: true });
  await cp(resolve(projectRoot, "LICENSE"), resolve(tempRoot, "LICENSE"));
  await mutate(tempArtifacts);
  const result = await run(process.execPath, ["scripts/verify-artifacts.mjs"], tempRoot);
  await rm(tempRoot, { recursive: true, force: true });
  return { kind, exitCode: result.exitCode, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

const compiler = [
  compilerProbe(
    "implicit-dynamic-text",
    `export function createView() { return <div>{items.map((item) => <span>{item}</span>)}</div>; }`,
  ),
  compilerProbe(
    "closure-shadowing",
    `export function createView() { return ruseact.conditional([visible], ({ runtime }) => runtime.get(visible), ({ runtime }) => <div>{runtime}</div>, ({ runtime }) => <span>{runtime}</span>); }`,
  ),
  compilerProbe(
    "supported-explicit-binding",
    `export function createView() { return <div>{ruseact.bindText([count], ({ runtime: currentRuntime }) => currentRuntime.get(count))}</div>; }`,
  ),
];

const runtimeResult = await createReactiveCore(() => wasm);
if (!runtimeResult.ok) throw new Error(`runtime setup failed: ${runtimeResult.error.code}`);
const runtime = runtimeResult.value;
const signalResult = runtime.createSignal(0);
if (!signalResult.ok) throw new Error(`signal setup failed: ${signalResult.error.code}`);
const signal = signalResult.value;
const runtimeDiagnostics = [
  { name: "invalid-signal-handle", result: runtime.set({}, 1) },
  { name: "disposed-signal-read", result: runtime.disposeSignal(signal) },
];
runtimeDiagnostics.push({ name: "read-after-dispose", result: runtime.get(signal) });
const badWasm = await createReactiveCore(() => ({}));
const invalidRoot = createRoot({});
const runtimeDisposed = runtime.dispose();

const verifier = [
  await verifierFailure("corrupted-artifact-checksum", async (root) => {
    const file = resolve(root, "ruseact-0.1.0-alpha.1.tgz");
    const bytes = await readFile(file);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(file, bytes);
  }),
  await verifierFailure("missing-artifact", async (root) => {
    await rm(resolve(root, "ruseact-compiler-0.1.0-alpha.1.tgz"));
  }),
];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  artifactSourceCommit: "2a0ab7781b6c56fde643bf6bc8ed3f550097209c",
  compiler,
  runtime: runtimeDiagnostics.map((entry) => ({ name: entry.name, result: entry.result })),
  initialization: { name: "unsupported-wasm-module", result: badWasm },
  renderer: { name: "invalid-root-container", result: invalidRoot },
  disposal: { name: "runtime-disposal", result: runtimeDisposed },
  verifier,
  checksumMethod: `sha256:${createHash("sha256").update(await readFile(resolve(artifactRoot, "ruseact-0.1.0-alpha.1.tgz"))).digest("hex")}`,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, "negative-results.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
