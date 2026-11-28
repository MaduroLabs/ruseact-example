import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const audit = resolve(root, ".agents/skills/frontend-design-guardian/scripts/audit-design.mjs");
const fixture = (name) => resolve(root, ".agents/skills/frontend-design-guardian/fixtures/design-audit", name);
const run = (file, viewport = "1440x900") => new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [audit, "--json", "--viewport=" + viewport, file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolvePromise(JSON.parse(stdout)) : reject(new Error(stderr || "audit exited " + code)));
});
const codes = (report) => new Set(report.findings.map((finding) => finding.code));
const severities = (report, code) => report.findings.filter((finding) => finding.code === code).map((finding) => finding.severity);
const requireCodes = (report, expected, label) => {
  const actual = codes(report);
  for (const code of expected) if (!actual.has(code)) throw new Error(label + " missed " + code + ": " + JSON.stringify([...actual]));
};

const positive = await run(fixture("positive.html"));
const negative = await run(fixture("negative.html"));
const uppercase = await run(fixture("uppercase-context.html"));
const typography = await run(fixture("typography-roles.html"));
const contrast = await run(fixture("contrast-negative.html"));
const scroll = await run(fixture("overflow-scroll-positive.html"));
const mobile = await run(fixture("uppercase-context.html"), "390x844");

if (positive.findings.some((finding) => finding.severity === "ERROR")) {
  throw new Error("positive fixture produced errors: " + JSON.stringify(positive.findings));
}
requireCodes(negative, ["TYPO-01", "TYPO-05", "TYPO-03", "TYPO-04", "LAY-03", "COPY-01", "COPY-02", "A11Y-01", "COLOR-01"], "negative fixture");
requireCodes(uppercase, ["TYPO-05"], "uppercase fixture");
if (codes(uppercase).has("TYPO-01")) throw new Error("uppercase fixture incorrectly reported bold body text");
for (const text of ["PREVIEW", "SOURCE", "FEATURES", "OVERVIEW"]) {
  if (!uppercase.findings.some((finding) => finding.code === "TYPO-05" && finding.evidence.some((item) => item.text === text))) {
    throw new Error("uppercase fixture did not identify " + text);
  }
}
const cssTransformed = uppercase.textRuns.find((run) => run.text === "preview");
if (!cssTransformed || cssTransformed.style.textTransform !== "uppercase" || !cssTransformed.uppercase) {
  throw new Error("lowercase CSS-transformed text was not classified as uppercase");
}
if (!uppercase.findings.some((finding) => finding.code === "TYPO-05" && finding.evidence.some((item) => item.text === "preview"))) {
  throw new Error("CSS-transformed lowercase text did not produce uppercase evidence");
}
for (const acronym of ["WASM", "API", "DOM", "CSS", "JSX", "TSX", "HTTP"]) {
  if (uppercase.textRuns.some((run) => run.text === acronym && (!run.technical || run.uppercase))) {
    throw new Error("technical acronym was not excluded safely: " + acronym);
  }
}
if (!severities(uppercase, "TYPO-05").includes("ERROR")) throw new Error("tracked or repeated uppercase labels were not an error");
requireCodes(typography, ["TYPO-01", "TYPO-02", "TYPO-05", "TYPO-07", "TYPO-08", "IA-03"], "typography role fixture");
if (!severities(typography, "TYPO-01").includes("ERROR")) throw new Error("bold body text was not an error");
if (!severities(typography, "TYPO-02").includes("WARNING")) throw new Error("semibold body text was not a warning");
if (!severities(typography, "TYPO-08").includes("WARNING")) throw new Error("heavy navigation was not a warning");
for (const [text, role] of [["Nested navigation", "navigation"], ["This nested body text remains body content.", "body"], ["Increment", "control"], ["Runtime state", "label"]]) {
  const run = typography.textRuns.find((item) => item.text === text && item.style.role === role);
  if (!run || run.style.role !== role) throw new Error("nested semantic role was not inherited for " + text + ": " + JSON.stringify(run?.style.role));
}
const emphasis = typography.textRuns.find((run) => run.text === "Important detail");
if (!emphasis || emphasis.style.role !== "emphasis") throw new Error("legitimate nested emphasis was not preserved");
if (typography.findings.some((finding) => finding.code === "TYPO-01" && finding.evidence.some((item) => item.text === "Important detail"))) {
  throw new Error("legitimate semantic emphasis was incorrectly reported as ordinary bold text");
}
requireCodes(contrast, ["COLOR-01", "COLOR-MANUAL"], "contrast fixture");
if (!severities(contrast, "COLOR-MANUAL").includes("OBSERVATION")) throw new Error("ambiguous contrast was not manual review");
if (!contrast.findings.some((finding) => finding.code === "COLOR-01" && finding.evidence.some((item) => item.text === "Metadata below the contrast threshold."))) {
  throw new Error("metadata contrast was excluded from measurable review");
}
if (!contrast.findings.some((finding) => finding.code === "COLOR-MANUAL" && finding.evidence.some((item) => item.text.includes("opaque local background under ancestor opacity")))) {
  throw new Error("ancestor opacity over an opaque local background was not manual review");
}
if (codes(contrast).has("RESP-01")) throw new Error("wide contrast fixture unexpectedly overflowed at desktop");
if (codes(scroll).has("RESP-01")) throw new Error("intentional scroll container was reported as page overflow");
if (!scroll.overflow.intentionalScrollContainers.length) throw new Error("intentional scroll container was not recorded");
if (mobile.requestedViewport.width !== 390 || mobile.requestedViewport.height !== 844) throw new Error("requested mobile viewport was not preserved");
if (!mobile.observedViewport || typeof mobile.observedViewport.devicePixelRatio !== "number") throw new Error("observed viewport metadata was not preserved");
const expectedMatch = mobile.observedViewport.width === 390 && mobile.observedViewport.height === 844;
if (mobile.viewportMatched !== expectedMatch) throw new Error("viewport mismatch metadata is inconsistent");

console.log(JSON.stringify({
  positive: { errors: positive.findings.filter((finding) => finding.severity === "ERROR").length, findings: positive.findings.length },
  negative: { findings: negative.findings.length, codes: [...codes(negative)].sort() },
  focused: {
    uppercase: [...codes(uppercase)].sort(),
    typography: [...codes(typography)].sort(),
    contrast: [...codes(contrast)].sort(),
    intentionalScroll: [...codes(scroll)].sort(),
  },
  technicalIdentifierExcluded: true,
  viewportMetadataRegression: {
    requested: mobile.requestedViewport,
    observed: mobile.observedViewport,
    matched: mobile.viewportMatched,
  },
}, null, 2));
