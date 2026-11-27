import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const file = resolve(projectRoot, "target/consumer-audit/benchmark-results.json");
const report = JSON.parse(await readFile(file, "utf8"));
if (report.schemaVersion !== 1) throw new Error("unsupported benchmark schema");
if (report.runs?.length !== 3) throw new Error(`expected three independent runs, got ${report.runs?.length}`);
if (!report.workloads?.length) throw new Error("benchmark report has no workloads");

let invalid = 0;
let unresolved = 0;
let invalidUnresolvedSamples = 0;
for (const run of report.runs) {
  for (const row of run.results) {
    if (!Array.isArray(row.samples) || row.samples.length !== report.configuration.samples) {
      throw new Error(`${row.id}: incomplete sample set`);
    }
    for (const sample of row.samples) {
      if (!Number.isFinite(sample.durationMs) || sample.durationMs <= 0) {
        if (row.summary.measurementStatus === "unresolved") invalidUnresolvedSamples += 1;
        else invalid += 1;
      }
      if (!Number.isInteger(sample.operationCount) || sample.operationCount <= 0) invalid += 1;
      if (!Number.isInteger(sample.flushCalls) || sample.flushCalls < 0) invalid += 1;
    }
    if (row.summary.measurementStatus === "unresolved") unresolved += 1;
  }
}
if (invalid > 0) throw new Error(`benchmark integrity rejected ${invalid} invalid sample fields`);
console.log(`Consumer benchmark integrity passed: ${report.runs.length} runs, ${report.workloads.length} workloads, ${unresolved} unresolved rows, ${invalidUnresolvedSamples} unresolved non-positive samples retained as invalid evidence.`);
