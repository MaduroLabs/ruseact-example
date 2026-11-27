import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chromium = process.env.CHROMIUM || "chromium";
const root = resolve(process.cwd());
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const viewportArg = args.find((value) => value.startsWith("--viewport=")) || "--viewport=1440x900";
const targetArg = args.find((value) => !value.startsWith("--"));
if (!targetArg) {
  console.error("usage: node audit-design.mjs [--json] [--viewport=1440x900] path/to/page.html");
  process.exit(2);
}
const target = resolve(root, targetArg);
const viewportMatch = viewportArg.replace("--viewport=", "").match(/^(\d+)x(\d+)$/);
if (!viewportMatch) throw new Error("invalid viewport: " + viewportArg);
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    sleep(2_000),
  ]);
};

function browserAudit() {
  const ignoredText = (element) => Boolean(element.closest("script,style,template,pre,code,[hidden],[aria-hidden='true'],[data-design-audit-ignore]"));
  const visible = (element) => {
    if (!element || ignoredText(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const selector = (element) => {
    if (!element) return "";
    const id = element.id ? "#" + element.id : "";
    const classes = [...element.classList].slice(0, 2).map((name) => "." + name).join("");
    return element.tagName.toLowerCase() + id + classes;
  };
  const parseColor = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const background = (element) => {
    let current = element;
    while (current) {
      const color = parseColor(getComputedStyle(current).backgroundColor);
      if (color && color.a > 0) return color;
      current = current.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const luminance = (color) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (foreground, element) => {
    const bg = background(element);
    const a = luminance(foreground);
    const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const numericPx = (value) => Number.parseFloat(value.replace("px", "")) || 0;
  const technical = (text) => /^[A-Z0-9_.:/+@-]+$/.test(text) || /^v?\d+(?:\.\d+)+$/.test(text);
  const words = (text) => new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
  const overlap = (a, b) => {
    const left = words(a);
    const right = words(b);
    if (!left.size || !right.size) return 0;
    return [...left].filter((word) => right.has(word)).length / Math.min(left.size, right.size);
  };
  const styleOf = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const foreground = parseColor(style.color);
    return {
      selector: selector(element),
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180),
      fontFamily: style.fontFamily,
      fontSize: numericPx(style.fontSize),
      fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
      textTransform: style.textTransform,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      color: style.color,
      contrast: foreground ? Number(contrast(foreground, element).toFixed(2)) : null,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };
  const isUppercase = (text, style) => {
    const letters = text.replace(/[^A-Za-z]/g, "");
    if (letters.length < 4 || technical(text)) return false;
    return style.textTransform === "uppercase" || letters === letters.toUpperCase();
  };
  const textRuns = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() || "";
    const element = node.parentElement;
    if (!text || !element || !visible(element)) continue;
    const style = styleOf(element);
    textRuns.push({
      text: text.slice(0, 240),
      selector: style.selector,
      style,
      uppercase: isUppercase(text, style),
      technical: technical(text),
    });
  }
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map(styleOf);
  const controls = [...document.querySelectorAll("button,a[href],input,select,textarea,[role='button']")].filter(visible).map((element) => ({
    ...styleOf(element),
    name: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 160),
  }));
  const findings = [];
  const add = (code, severity, message, evidence) => findings.push({ code, severity, message, evidence });
  const boldRuns = textRuns.filter((run) => run.style.fontWeight >= 700);
  if (textRuns.length >= 6 && boldRuns.length / textRuns.length >= 0.75) {
    add("TYPO-01", "ERROR", "Most visible text runs use bold or heavier weight.", boldRuns.slice(0, 8));
  }
  const uppercaseRuns = textRuns.filter((run) => run.uppercase && !run.technical);
  if (uppercaseRuns.length >= 3) {
    add("TYPO-05", "ERROR", "Repeated ordinary interface text is uppercase; review sentence case.", uppercaseRuns.slice(0, 10));
  }
  const largeHeadings = headings.filter((heading) => heading.fontSize >= 56);
  if (largeHeadings.length) {
    add("TYPO-03", "WARNING", "A heading is at least 56px; verify that scale serves the task and viewport.", largeHeadings.slice(0, 5));
  }
  const tightHeadings = headings.filter((heading) => {
    const tracking = numericPx(heading.letterSpacing);
    return heading.fontSize >= 40 && tracking < -(heading.fontSize * 0.02);
  });
  if (tightHeadings.length) {
    add("TYPO-04", "WARNING", "A large heading uses materially negative letter spacing.", tightHeadings.slice(0, 5));
  }
  const numbered = textRuns.filter((run) => /^\d{1,2}\s*[/.:-]\s*\S/.test(run.text) && !run.selector.startsWith("li"));
  if (numbered.length) add("LAY-03", "WARNING", "A numbered marker may be decorative rather than a real sequence.", numbered.slice(0, 8));
  const banned = textRuns.filter((run) => /\b(unlock|elevate|seamless|revolutionary|experience the power|a new era|crafted for|built different)\b/i.test(run.text));
  if (banned.length) add("COPY-01", "WARNING", "Marketing vocabulary needs a concrete product justification.", banned.slice(0, 8));
  const redundant = [];
  for (const heading of [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible)) {
    const next = heading.nextElementSibling;
    if (next && visible(next) && overlap(heading.textContent || "", next.textContent || "") >= 0.6) {
      redundant.push({ heading: styleOf(heading), following: styleOf(next), overlap: overlap(heading.textContent || "", next.textContent || "") });
    }
  }
  if (redundant.length) add("COPY-02", "WARNING", "Adjacent heading and description repeat the same information.", redundant);
  const smallControls = controls.filter((control) => control.name && control.fontSize < 12);
  if (smallControls.length) add("A11Y-01", "ERROR", "A named functional control is below the proposed 12px minimum.", smallControls);
  const lowContrast = controls.filter((control) => control.name && control.contrast !== null && control.contrast < 4.5);
  if (lowContrast.length) add("COLOR-01", "ERROR", "A named functional control has measurable contrast below 4.5:1.", lowContrast);
  const allElements = [...document.querySelectorAll("*")].filter(visible);
  const viewportOverflowElements = allElements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > window.innerWidth + 1;
  });
  const overflow = {
    document: document.documentElement.scrollWidth > window.innerWidth + 1,
    body: document.body.scrollWidth > window.innerWidth + 1,
    elements: viewportOverflowElements.slice(0, 10).map(styleOf),
  };
  if (overflow.document || overflow.body || viewportOverflowElements.length) add("RESP-01", "ERROR", "Visible page content overflows or is cropped by the viewport.", { viewport: { width: innerWidth, height: innerHeight }, overflow });
  const shadowed = allElements.filter((element) => getComputedStyle(element).boxShadow !== "none");
  const rounded = allElements.filter((element) => numericPx(getComputedStyle(element).borderTopLeftRadius) >= 12);
  if (shadowed.length >= 4 && rounded.length >= 4) {
    add("CONT-02", "WARNING", "Multiple visible surfaces combine rounded corners and shadows; inspect whether chrome is doing useful work.", { shadowed: shadowed.slice(0, 8).map(styleOf), rounded: rounded.slice(0, 8).map(styleOf) });
  }
  const textCounts = new Map();
  for (const run of textRuns) if (run.text.length >= 12) textCounts.set(run.text, (textCounts.get(run.text) || 0) + 1);
  const repeatedText = [...textCounts.entries()].filter(([, count]) => count > 1).map(([text, count]) => ({ text, count }));
  const weights = [...new Set(textRuns.map((run) => run.style.fontWeight))].sort((a, b) => a - b);
  const fontFamilies = [...new Set(textRuns.map((run) => run.style.fontFamily))];
  return {
    schemaVersion: 1,
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    metrics: { visibleTextRuns: textRuns.length, boldTextRuns: boldRuns.length, uppercaseTextRuns: uppercaseRuns.length, headingCount: headings.length, controlCount: controls.length, fontWeights: weights, fontFamilies, shadowedElementCount: shadowed.length, roundedElementCount: rounded.length, repeatedText },
    textRuns: textRuns.slice(0, 250),
    headings,
    controls,
    findings,
    overflow,
    thresholdPolicy: {
      allBold: "ERROR when at least 6 visible text runs exist and 75% are weight >= 700; proposed project heuristic.",
      uppercase: "ERROR when at least 3 ordinary visible runs are uppercase; technical identifiers are excluded.",
      largeHeading: "WARNING at 56px or larger; proposed project heuristic, not a universal limit.",
      smallControl: "ERROR below 12px for named controls; proposed project minimum.",
      controlContrast: "ERROR below 4.5:1 where solid colors are measurable; verify disabled/state exceptions.",
    },
  };
}

let browser;
let profile;
try {
  profile = await mkdtemp(resolve(tmpdir(), "ruseact-design-audit-"));
  const source = await readFile(target, "utf8");
  const injection = "<script>(function(){const report=(" + browserAudit.toString() + ")();const pre=document.createElement('pre');pre.id='__design_audit_result';pre.textContent=encodeURIComponent(JSON.stringify(report));document.body.append(pre);})();</script>";
  const instrumented = resolve(profile, "audit.html");
  await writeFile(instrumented, source + injection);
  browser = spawn(chromium, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--no-proxy-server",
    "--allow-file-access-from-files", "--window-size=" + viewport.width + "," + viewport.height, "--user-data-dir=" + profile,
    "--virtual-time-budget=1500", "--dump-dom", pathToFileURL(instrumented).href,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  browser.stdout.on("data", (chunk) => { stdout += chunk; });
  browser.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolvePromise, reject) => {
    browser.once("error", reject);
    browser.once("exit", resolvePromise);
  });
  if (exitCode !== 0) throw new Error("Chromium audit failed with exit code " + exitCode + ": " + stderr.slice(-2000));
  const resultMatch = stdout.match(/<pre id="__design_audit_result">([^<]*)<\/pre>/);
  if (!resultMatch) throw new Error("Chromium audit did not emit a result marker. stderr: " + stderr.slice(-2000));
  const report = JSON.parse(decodeURIComponent(resultMatch[1]));
  report.target = target;
  report.browser = chromium;
  report.viewport = viewport;
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(target + " @ " + viewport.width + "x" + viewport.height);
    console.log("text runs=" + report.metrics.visibleTextRuns + " headings=" + report.metrics.headingCount + " controls=" + report.metrics.controlCount);
    for (const finding of report.findings) console.log(finding.severity + " " + finding.code + ": " + finding.message);
    console.log("overflow=" + JSON.stringify(report.overflow));
  }
} finally {
  await stop(browser);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
