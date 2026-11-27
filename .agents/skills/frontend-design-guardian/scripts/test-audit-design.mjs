import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const audit = resolve(root, ".agents/skills/frontend-design-guardian/scripts/audit-design.mjs");
const fixture = (name) => resolve(root, ".agents/skills/frontend-design-guardian/fixtures/design-audit", name);
const run = (file) => new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [audit, "--json", "--viewport=1440x900", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolvePromise(JSON.parse(stdout)) : reject(new Error(stderr || "audit exited " + code)));
});

const positive = await run(fixture("positive.html"));
const negative = await run(fixture("negative.html"));
const positiveErrors = positive.findings.filter((finding) => finding.severity === "ERROR");
const negativeCodes = new Set(negative.findings.map((finding) => finding.code));
if (positiveErrors.length) throw new Error("positive fixture produced errors: " + JSON.stringify(positiveErrors));
for (const code of ["TYPO-01", "TYPO-05", "TYPO-03", "TYPO-04", "LAY-03", "COPY-01", "COPY-02", "A11Y-01", "COLOR-01"]) {
  if (!negativeCodes.has(code)) throw new Error("negative fixture missed " + code + ": " + JSON.stringify([...negativeCodes]));
}
const wasmRun = positive.textRuns.find((run) => run.text === "WASM");
if (!wasmRun?.technical || wasmRun.uppercase) throw new Error("legitimate technical acronym was not classified safely");
console.log(JSON.stringify({
  positive: { errors: positiveErrors.length, findings: positive.findings.length },
  negative: { findings: negative.findings.length, codes: [...negativeCodes].sort() },
  technicalIdentifierExcluded: true,
}, null, 2));
