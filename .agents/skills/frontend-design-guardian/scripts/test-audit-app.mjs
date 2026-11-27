import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const chromium = process.env.CHROMIUM || "chromium";
const audit = resolve(root, ".agents/skills/frontend-design-guardian/scripts/audit-design.mjs");
const auditDist = process.env.RUSEACT_AUDIT_DIST ?? "dist-test";
const auditQuery = process.env.RUSEACT_AUDIT_QUERY ?? "benchmark=1&design-audit=1";
const auditReadyText = process.env.RUSEACT_AUDIT_READY_TEXT ?? "Hello, world!";
const auditReadyExpression = process.env.RUSEACT_AUDIT_READY_EXPRESSION ?? "Boolean(window.__ruseactAuditMount)";
const freePort = () => new Promise((resolvePromise, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolvePromise(port));
  });
});
const waitHttp = (port) => new Promise((resolvePromise, reject) => {
  const started = Date.now();
  const poll = () => {
    const req = request("http://127.0.0.1:" + port + "/", (response) => {
      response.resume();
      response.once("end", () => response.statusCode >= 200 && response.statusCode < 500 ? resolvePromise() : retry());
    });
    req.once("error", retry);
    req.end();
  };
  const retry = () => Date.now() - started > 15_000 ? reject(new Error("timed out waiting for Vite preview")) : setTimeout(poll, 100);
  poll();
});
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
  ]);
};
const port = await freePort();
const preview = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--outDir", auditDist, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
let auditProcess;
try {
  await waitHttp(port);
  const url = "http://127.0.0.1:" + port + "/hello.html" + (auditQuery ? "?" + auditQuery : "");
  const reports = [];
  for (const viewport of ["1440x900", "390x844"]) {
    auditProcess = spawn(process.execPath, [
      audit,
      "--json",
      "--viewport=" + viewport,
      "--url=" + url,
      "--ready-text=" + auditReadyText,
      "--ready-expression=" + auditReadyExpression,
    ], { cwd: root, env: { ...process.env, CHROMIUM: chromium }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    auditProcess.stdout.on("data", (chunk) => { stdout += chunk; });
    auditProcess.stderr.on("data", (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolvePromise, reject) => {
      auditProcess.once("error", reject);
      auditProcess.once("exit", resolvePromise);
    });
    if (exitCode !== 0) throw new Error(stderr || "served application audit exited " + exitCode);
    const report = JSON.parse(stdout);
    if (report.mode !== "served-application") throw new Error("application audit did not use served mode");
    if (!report.application?.mounted || !report.application?.styleSheets || report.application.failedAssets.length || report.application.error) {
      throw new Error("application audit readiness evidence was incomplete: " + JSON.stringify(report.application));
    }
    if (!report.metrics.visibleTextRuns || !report.viewportMatched) throw new Error("application audit did not produce a complete mounted viewport report: " + JSON.stringify({ requestedViewport: report.requestedViewport, observedViewport: report.observedViewport, viewportMatched: report.viewportMatched, visibleTextRuns: report.metrics.visibleTextRuns }));
    reports.push({
      mode: report.mode,
      target: report.target,
      requestedViewport: report.requestedViewport,
      observedViewport: report.observedViewport,
      mounted: report.application.mounted,
      styleSheets: report.application.styleSheets,
      failedAssets: report.application.failedAssets,
      visibleTextRuns: report.metrics.visibleTextRuns,
      findings: report.findings.map((finding) => ({ code: finding.code, severity: finding.severity })),
    });
  }
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await stop(auditProcess);
  await stop(preview);
}
