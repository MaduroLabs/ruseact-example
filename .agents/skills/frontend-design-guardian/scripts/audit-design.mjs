import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chromium = process.env.CHROMIUM || "chromium";
const root = resolve(process.cwd());
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const viewportArg = args.find((value) => value.startsWith("--viewport=")) || "--viewport=1440x900";
const urlArg = args.find((value) => value.startsWith("--url="))?.slice("--url=".length);
const readyText = args.find((value) => value.startsWith("--ready-text="))?.slice("--ready-text=".length);
const readyExpression = args.find((value) => value.startsWith("--ready-expression="))?.slice("--ready-expression=".length);
const targetArg = args.find((value) => !value.startsWith("--"));
if ((!targetArg && !urlArg) || (targetArg && urlArg)) {
  console.error("usage: node audit-design.mjs [--json] [--viewport=1440x900] path/to/page.html");
  console.error("   or: node audit-design.mjs [--json] [--viewport=1440x900] --url=http://... --ready-text=... --ready-expression=...");
  process.exit(2);
}
if (urlArg && (!readyText || !readyExpression)) {
  throw new Error("served application audits require both --ready-text and --ready-expression");
}
const target = targetArg ? resolve(root, targetArg) : null;
const viewportMatch = viewportArg.replace("--viewport=", "").match(/^(\d+)x(\d+)$/);
if (!viewportMatch) throw new Error("invalid viewport: " + viewportArg);
const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const freePort = () => new Promise((resolvePromise, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolvePromise(port));
  });
});
const waitForTarget = async (debugPort) => {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    try {
      const response = await fetch("http://127.0.0.1:" + debugPort + "/json/list");
      const targets = await response.json();
      const targetEntry = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
      if (targetEntry) return targetEntry.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("timed out waiting for Chromium DevTools target");
};
const connect = async (webSocketUrl) => {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listener = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  socket.addEventListener("message", listener);
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error("Chromium DevTools connection closed"));
    pending.clear();
  });
  return {
    command(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.removeEventListener("message", listener);
      socket.close();
    },
  };
};
const sendCommand = async (webSocketUrl, method, params = {}) => {
  const client = await connect(webSocketUrl);
  try {
    return await client.command(method, params);
  } finally {
    client.close();
  }
};
const evaluate = async (webSocketUrl, expression, client = null) => {
  const result = await (client ? client.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }) : sendCommand(webSocketUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }));
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  }
  return result?.result?.value;
};
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
    if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const background = (element) => {
    let current = element;
    let inheritedOpacity = 1;
    let color = null;
    let complexBackground = false;
    while (current) {
      const style = getComputedStyle(current);
      const opacity = Number.parseFloat(style.opacity);
      if (Number.isFinite(opacity)) inheritedOpacity *= opacity;
      if (!color) {
        if (style.backgroundImage !== "none") complexBackground = true;
        const candidate = parseColor(style.backgroundColor);
        if (candidate && candidate.a > 0) color = candidate;
      }
      current = current.parentElement;
    }
    if (!color) return { color: null, status: "manual", reason: complexBackground ? "background image or gradient" : "no solid ancestor background" };
    if (complexBackground || color.a < 1 || inheritedOpacity < 1) {
      return { color, status: "manual", reason: complexBackground ? "background image or gradient" : "transparent background or ancestor opacity" };
    }
    return { color, status: "measured", reason: null };
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
    if (!foreground || foreground.a < 1 || bg.status !== "measured") {
      return { ratio: null, status: "manual", reason: bg.reason || "text alpha or ancestor opacity" };
    }
    const a = luminance(foreground);
    const b = luminance(bg.color);
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), status: "measured", reason: null };
  };
  const numericPx = (value) => Number.parseFloat(value.replace("px", "")) || 0;
  const knownTechnicalTerms = new Set(["API", "WASM", "DOM", "CSS", "JSX", "TSX", "HTTP", "HTML", "URL", "JSON", "Uint32Array"]);
  const technical = (text) => {
    const value = text.trim();
    if (knownTechnicalTerms.has(value) || /^v?\d+(?:\.\d+)+$/.test(value)) return true;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:[._:-][A-Za-z0-9_$-]+)+$/.test(value)) return true;
    return /[{}()[\]<>=>]/.test(value) || /^[A-Z0-9_]+_[A-Z0-9_]+$/.test(value);
  };
  const words = (text) => new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
  const overlap = (a, b) => {
    const left = words(a);
    const right = words(b);
    if (!left.size || !right.size) return 0;
    return [...left].filter((word) => right.has(word)).length / Math.min(left.size, right.size);
  };
  const localRole = (element) => {
    const tag = element.tagName.toLowerCase();
    const ariaRole = element.getAttribute("role");
    if (/^h[1-6]$/.test(tag) || ariaRole === "heading") return "heading";
    if (tag === "strong" || tag === "b" || tag === "em") return "emphasis";
    if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || ["button", "checkbox", "combobox", "listbox", "radio", "slider", "switch"].includes(ariaRole)) return "control";
    if (tag === "nav" || tag === "a" && element.hasAttribute("href") || ariaRole === "navigation") return "navigation";
    if (tag === "label" || element.classList.contains("label")) return "label";
    if (tag === "small" || element.matches(".eyebrow,.meta,.side-label,[data-meta]")) return "metadata";
    if (tag === "p" || tag === "li") return "body";
    return null;
  };
  const roleOf = (element) => {
    let current = element;
    while (current) {
      const role = localRole(current);
      if (role) return role;
      current = current.parentElement;
    }
    return "other";
  };
  const styleOf = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const foreground = parseColor(style.color);
    const contrastResult = contrast(foreground, element);
    const role = roleOf(element);
    return {
      selector: selector(element),
      tag: element.tagName.toLowerCase(),
      role,
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 180),
      fontFamily: style.fontFamily,
      fontSize: numericPx(style.fontSize),
      fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
      textTransform: style.textTransform,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      color: style.color,
      contrast: contrastResult.ratio === null ? null : Number(contrastResult.ratio.toFixed(2)),
      contrastStatus: contrastResult.status,
      contrastReason: contrastResult.reason,
      disabled: element.matches(":disabled,[aria-disabled='true']"),
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };
  const isUppercase = (text, style) => {
    const letters = text.replace(/[^A-Za-z]/g, "");
    if (letters.length < 3 || technical(text)) return false;
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
  const bodyRuns = textRuns.filter((run) => ["body", "label", "metadata", "navigation", "control"].includes(run.style.role));
  const boldBody = bodyRuns.filter((run) => run.style.fontWeight >= 700 && run.style.role !== "emphasis");
  const semiboldBody = bodyRuns.filter((run) => run.style.fontWeight >= 600 && run.style.fontWeight < 700 && run.style.role === "body");
  const heavyNavigation = bodyRuns.filter((run) => run.style.role === "navigation" && run.style.fontWeight >= 600);
  if (boldBody.length) add("TYPO-01", "ERROR", "Ordinary body, metadata, navigation, label, or control text uses bold weight; verify a semantic need.", boldBody.slice(0, 12));
  if (semiboldBody.length >= 2) add("TYPO-02", "WARNING", "Semibold body text is repeated outside a documented emphasis role.", semiboldBody.slice(0, 12));
  if (heavyNavigation.length >= 2) add("TYPO-08", "WARNING", "Navigation uses repeated semibold or bold emphasis; verify information hierarchy.", heavyNavigation.slice(0, 12));
  const uppercaseRuns = textRuns.filter((run) => run.uppercase && !run.technical);
  for (const run of uppercaseRuns) {
    const tracked = numericPx(run.style.letterSpacing) > 0.2 || run.style.textTransform === "uppercase";
    add("TYPO-05", uppercaseRuns.length >= 3 || tracked ? "ERROR" : "WARNING", "Ordinary interface text is uppercase; review sentence case and technical exceptions.", [run]);
  }
  const trackedLabels = textRuns.filter((run) => ["label", "metadata", "navigation"].includes(run.style.role) && run.uppercase && numericPx(run.style.letterSpacing) > 0.2);
  if (trackedLabels.length >= 2) add("TYPO-05", "ERROR", "Repeated tracked uppercase labels create decorative emphasis instead of information hierarchy.", trackedLabels.slice(0, 12));
  const eyebrowHeadings = textRuns.filter((run) => {
    const element = document.querySelector(run.selector);
    return element?.classList.contains("eyebrow") && element.nextElementSibling?.matches("h1,h2,h3,h4,h5,h6");
  });
  if (eyebrowHeadings.length) add("IA-03", "WARNING", "Eyebrow text precedes a heading; verify that it adds task information rather than ceremony.", eyebrowHeadings.slice(0, 8));
  const monoOrdinary = bodyRuns.filter((run) => ["body", "navigation"].includes(run.style.role) && /mono/i.test(run.style.fontFamily));
  if (monoOrdinary.length >= 1) add("TYPO-07", "WARNING", "Monospace is applied to ordinary prose or navigation; reserve it for code/data or document the technical rationale.", monoOrdinary.slice(0, 12));
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
  const smallControls = controls.filter((control) => control.name && control.fontSize < 12 && !control.disabled);
  if (smallControls.length) add("A11Y-01", "ERROR", "A named functional control is below the proposed 12px minimum.", smallControls);
  const contrastRuns = textRuns.filter((run) => run.style.contrastStatus === "measured" && run.style.contrast !== null);
  const lowContrast = contrastRuns.filter((run) => {
    const large = run.style.fontSize >= 24 || (run.style.fontSize >= 18.66 && run.style.fontWeight >= 700);
    return run.style.contrast < (large ? 3 : 4.5) && !run.style.disabled;
  });
  if (lowContrast.length) add("COLOR-01", "ERROR", "Visible text has measurable contrast below the size-appropriate threshold.", lowContrast.slice(0, 12));
  const ambiguousContrast = textRuns.filter((run) => run.style.contrastStatus === "manual");
  if (ambiguousContrast.length) add("COLOR-MANUAL", "OBSERVATION", "Contrast could not be measured from a solid opaque background; review manually.", ambiguousContrast.slice(0, 12));
  const disabledContrast = textRuns.filter((run) => run.style.disabled && run.style.contrastStatus === "measured");
  if (disabledContrast.length) add("COLOR-MANUAL", "OBSERVATION", "Disabled-state contrast is reported for manual state review rather than treated as a normal-control failure.", disabledContrast.slice(0, 12));
  const allElements = [...document.querySelectorAll("*")].filter(visible);
  const insideIntentionalScrollContainer = (element) => {
    let current = element.parentElement;
    while (current) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowX) && current.scrollWidth > current.clientWidth + 1) return true;
      current = current.parentElement;
    }
    return false;
  };
  const viewportOverflowElements = allElements.filter((element) => {
    const rect = element.getBoundingClientRect();
    return (rect.left < -1 || rect.right > window.innerWidth + 1) && !insideIntentionalScrollContainer(element);
  });
  const intentionalScrollContainers = allElements.filter((element) => {
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  });
  const overflow = {
    document: document.documentElement.scrollWidth > window.innerWidth + 1,
    body: document.body.scrollWidth > window.innerWidth + 1,
    elements: viewportOverflowElements.slice(0, 10).map(styleOf),
    intentionalScrollContainers: intentionalScrollContainers.slice(0, 10).map(styleOf),
  };
  if (viewportOverflowElements.length || ((overflow.document || overflow.body) && !intentionalScrollContainers.length)) {
    add("RESP-01", "ERROR", "Visible page content overflows or is cropped by the viewport.", { viewport: { width: innerWidth, height: innerHeight }, overflow });
  } else if (overflow.document || overflow.body) {
    add("RESP-MANUAL", "OBSERVATION", "Horizontal overflow is contained by an intentional scroll region; verify keyboard and touch access manually.", { viewport: { width: innerWidth, height: innerHeight }, overflow });
  }
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
  const roleCounts = Object.fromEntries([...new Set(textRuns.map((run) => run.style.role))].map((role) => [role, textRuns.filter((run) => run.style.role === role).length]));
  return {
    schemaVersion: 1,
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    metrics: { visibleTextRuns: textRuns.length, boldTextRuns: boldRuns.length, uppercaseTextRuns: uppercaseRuns.length, headingCount: headings.length, controlCount: controls.length, fontWeights: weights, fontFamilies, roleCounts, shadowedElementCount: shadowed.length, roundedElementCount: rounded.length, repeatedText },
    textRuns: textRuns.slice(0, 250),
    headings,
    controls,
    findings,
    overflow,
    thresholdPolicy: {
      boldBody: "ERROR for any ordinary body, metadata, navigation, label, or control run at weight >= 700; semantic emphasis and headings are excluded.",
      semiboldBody: "WARNING for at least 2 body runs at weight >= 600 outside a semantic emphasis role.",
      navigationWeight: "WARNING for at least 2 navigation runs at weight >= 600.",
      uppercase: "WARNING for one ordinary uppercase run and ERROR for repeated or tracked ordinary uppercase runs; a contextual technical vocabulary and structured identifiers are excluded.",
      largeHeading: "WARNING at 56px or larger; proposed project heuristic, not a universal limit.",
      smallControl: "ERROR below 12px for named non-disabled controls; proposed project minimum.",
      contrast: "ERROR only for measured solid opaque colors for every text role using 4.5:1 normal text or 3:1 large text; transparent, gradient, alpha, ancestor-opacity, and disabled cases require manual review.",
      overflow: "ERROR for visible elements cropped by the viewport unless they are inside an intentionally scrollable container.",
    },
  };
}

const printReport = (report) => {
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(report.target + " @ requested " + report.requestedViewport.width + "x" + report.requestedViewport.height + " / observed " + report.observedViewport.width + "x" + report.observedViewport.height);
    console.log("text runs=" + report.metrics.visibleTextRuns + " headings=" + report.metrics.headingCount + " controls=" + report.metrics.controlCount);
    for (const finding of report.findings) console.log(finding.severity + " " + finding.code + ": " + finding.message);
    console.log("viewportMatched=" + report.viewportMatched + " overflow=" + JSON.stringify(report.overflow));
  }
};

const annotateReport = (report, targetName, mode, application) => {
  report.target = targetName;
  report.mode = mode;
  report.browser = chromium;
  report.observedViewport = report.viewport;
  report.requestedViewport = viewport;
  report.viewportMatched = report.observedViewport.width === viewport.width && report.observedViewport.height === viewport.height;
  if (application) report.application = application;
  return report;
};

let browser;
let profile;
let cdp;
try {
  profile = await mkdtemp(resolve(tmpdir(), "ruseact-design-audit-"));
  if (urlArg) {
    const debugPort = await freePort();
    browser = spawn(chromium, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check", "--no-proxy-server",
      "--user-data-dir=" + profile, "--remote-debugging-port=" + debugPort,
      "--window-size=" + viewport.width + "," + viewport.height, "about:blank",
    ], { stdio: "ignore" });
    const webSocketUrl = await waitForTarget(debugPort);
    cdp = await connect(webSocketUrl);
    await cdp.command("Page.enable");
    await cdp.command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 600,
    });
    await cdp.command("Page.navigate", { url: urlArg });
    await cdp.command("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 600,
    });
    const readyProbe = "(() => ({ ready: document.readyState, text: document.body?.innerText || '', error: document.querySelector('[data-state=\"error\"]')?.textContent || null, marker: (" + readyExpression + ") }))()";
    const started = Date.now();
    let readyState;
    while (Date.now() - started < 15_000) {
      readyState = await evaluate(webSocketUrl, readyProbe, cdp);
      if (readyState.error) throw new Error("application mount failed: " + readyState.error);
      if (readyState.ready === "complete" && readyState.text.includes(readyText) && readyState.marker) break;
      await sleep(100);
    }
    if (!readyState || readyState.ready !== "complete" || !readyState.text.includes(readyText) || !readyState.marker) {
      throw new Error("application did not reach the declared ready state: " + JSON.stringify(readyState));
    }
    const application = await evaluate(webSocketUrl, "(() => ({ styleSheets: document.styleSheets.length, failedAssets: performance.getEntriesByType('resource').filter((entry) => entry.responseStatus >= 400).map((entry) => entry.name), mount: window.__ruseactAuditMount || null, appElement: Boolean(document.querySelector('#app')), appText: document.querySelector('#app')?.textContent?.trim() || '', error: document.querySelector('[data-state=\"error\"]')?.textContent || null }))()", cdp);
    if (!application.styleSheets) throw new Error("application audit found no loaded stylesheets");
    if (application.failedAssets.length) throw new Error("application audit found failed assets: " + JSON.stringify(application.failedAssets));
    if (application.error || !application.appElement) throw new Error("application audit found an invalid mounted page: " + JSON.stringify(application));
    const report = await evaluate(webSocketUrl, "(" + browserAudit.toString() + ")()", cdp);
    printReport(annotateReport(report, urlArg, "served-application", {
      readyText,
      readyExpression,
      readyState,
      ...application,
      mounted: Boolean(application.appElement && application.appText),
    }));
  } else {
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
    printReport(annotateReport(JSON.parse(decodeURIComponent(resultMatch[1])), target, "static-file"));
  }
} finally {
  cdp?.close();
  await stop(browser);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
