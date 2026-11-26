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

  const persistedDispatch = await evaluate(webSocketUrl, `(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.__ruseactCounterTest.setWithoutFlush(9);
    window.__ruseactCounterTest.flush();
    return {
      value: document.querySelector('output')?.textContent?.trim(),
      signalDisposed: window.__ruseactCounterTest.isApplicationSignalDisposed(),
    };
  })()`);
  if (persistedDispatch.value !== "9" || persistedDispatch.signalDisposed) {
    throw new Error(`Persisted pagehide incorrectly disposed the application: ${JSON.stringify(persistedDispatch)}`);
  }

  await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/hello.html?from=counter"; true`);
  await waitForPage(webSocketUrl, "Hello, world!");
  await evaluate(webSocketUrl, "history.back(); true");
  const returnedCounter = await waitForPage(webSocketUrl, "Counter");
  if (!returnedCounter.text.includes("Counter")) throw new Error(`Counter BFCache return failed: ${JSON.stringify(returnedCounter)}`);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  const bfcacheState = await evaluate(webSocketUrl, `({
    value: document.querySelector('output')?.textContent?.trim(),
    persisted: window.__ruseactCounterTest.wasPersistedPageShown(),
  })`);
  if (bfcacheState.persisted && bfcacheState.value !== "9") {
    throw new Error(`Persisted BFCache navigation lost application state: ${JSON.stringify(bfcacheState)}`);
  }

  const keyboard = await evaluate(webSocketUrl, `document.querySelector('button:nth-of-type(2)').focus(); document.activeElement === document.querySelector('button:nth-of-type(2)')`);
  if (!keyboard) throw new Error("Counter increment control did not receive focus");
  await sendCommand(webSocketUrl, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sendCommand(webSocketUrl, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  const keyboardState = await evaluate(webSocketUrl, `({
    value: document.querySelector('output')?.textContent?.trim(),
    handled: window.__ruseactCounterTest.getHandledEventCount(),
  })`);
  const expectedKeyboardValue = String(Number(bfcacheState.value ?? "0") + 1);
  if (keyboardState.value !== expectedKeyboardValue || keyboardState.handled < 1) {
    throw new Error(`Keyboard activation failed: ${JSON.stringify({ keyboardState, expectedKeyboardValue })}`);
  }

  const counterDisposal = await evaluate(webSocketUrl, `(() => {
    const oldButton = document.querySelector('button:nth-of-type(2)');
    const handledBefore = window.__ruseactCounterTest.getHandledEventCount();
    window.__ruseactCounterTest.dispose();
    window.__ruseactCounterTest.dispose();
    oldButton?.click();
    return {
      signalDisposed: window.__ruseactCounterTest.isApplicationSignalDisposed(),
      handledBefore,
      handledAfter: window.__ruseactCounterTest.getHandledEventCount(),
      outputStillMounted: document.querySelector('output') !== null,
    };
  })()`);
  if (!counterDisposal.signalDisposed || counterDisposal.handledAfter !== counterDisposal.handledBefore || counterDisposal.outputStillMounted) {
    throw new Error(`Explicit disposal or listener cleanup failed: ${JSON.stringify(counterDisposal)}`);
  }

  await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/conditional.html?test=1"; true`);
  const conditionalPage = await waitForPage(webSocketUrl, "Conditional Playground");
  if (!conditionalPage.text.includes("Conditional Playground")) {
    throw new Error(`Conditional Playground mount failed: ${JSON.stringify(conditionalPage)}`);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

  const initialConditional = await evaluate(webSocketUrl, `(() => {
    const app = document.querySelector('#app');
    const walker = document.createTreeWalker(app, NodeFilter.SHOW_COMMENT);
    const comments = [];
    let node;
    while ((node = walker.nextNode())) comments.push(node);
    const persistentInput = document.querySelector('[data-testid="persistent-input"]');
    persistentInput.value = 'preserve this value';
    window.__conditionalRefs = {
      persistentInput,
      observationPanel: document.querySelector('[data-testid="observations"]'),
      outerStart: comments[0],
      outerEnd: comments[comments.length - 1],
    };
    return {
      panel: window.__ruseactConditionalTest.getObservations(),
      comments: comments.length,
      hasPanel: document.querySelector('[data-testid="settings-panel"]') !== null,
      hasClosedState: document.querySelector('[data-testid="panel-disabled"]') !== null,
    };
  })()`);
  if (
    initialConditional.comments !== 2 ||
    initialConditional.hasPanel ||
    !initialConditional.hasClosedState ||
    initialConditional.panel.parentSetupCount !== 1 ||
    initialConditional.panel.settingsSetupCount !== 0 ||
    initialConditional.panel.advancedSetupCount !== 0 ||
    initialConditional.panel.panelVisible ||
    initialConditional.panel.advancedVisible
  ) {
    throw new Error(`Initial conditional state failed: ${JSON.stringify(initialConditional)}`);
  }

  const openedConditional = await evaluate(webSocketUrl, `(() => {
    window.__ruseactConditionalTest.setPanelWithoutFlush(true);
    window.__ruseactConditionalTest.flush();
    const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_COMMENT);
    const comments = [];
    let node;
    while ((node = walker.nextNode())) comments.push(node);
    window.__conditionalRefs.advancedToggle = document.querySelector('[data-testid="advanced-toggle"]');
    return {
      panel: window.__ruseactConditionalTest.getObservations(),
      comments: comments.length,
      outerStable: window.__conditionalRefs.outerStart === comments[0] && window.__conditionalRefs.outerEnd === comments[comments.length - 1],
      persistentStable: window.__conditionalRefs.persistentInput === document.querySelector('[data-testid="persistent-input"]'),
      persistentValue: document.querySelector('[data-testid="persistent-input"]').value,
      branchInput: document.querySelector('[data-testid="branch-input"]'),
      hasPanel: document.querySelector('[data-testid="settings-panel"]') !== null,
    };
  })()`);
  if (
    openedConditional.comments !== 4 ||
    !openedConditional.outerStable ||
    !openedConditional.persistentStable ||
    openedConditional.persistentValue !== "preserve this value" ||
    !openedConditional.branchInput ||
    !openedConditional.hasPanel ||
    openedConditional.panel.parentSetupCount !== 1 ||
    openedConditional.panel.settingsSetupCount !== 1 ||
    openedConditional.panel.advancedSetupCount !== 0
  ) {
    throw new Error(`Lazy conditional activation failed: ${JSON.stringify(openedConditional)}`);
  }
  await evaluate(webSocketUrl, `window.__conditionalRefs.branchInput = document.querySelector('[data-testid="branch-input"]'); true`);

  const nestedEnabled = await evaluate(webSocketUrl, `(() => {
    const oldAdvancedContent = document.querySelector('[data-testid="advanced-content"]');
    document.querySelector('[data-testid="advanced-toggle"]').click();
    return {
      panel: window.__ruseactConditionalTest.getObservations(),
      oldAdvancedContent,
      hasAdvanced: document.querySelector('[data-testid="advanced-content"]') !== null,
      comments: (() => {
        const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_COMMENT);
        let count = 0;
        while (walker.nextNode()) count += 1;
        return count;
      })(),
    };
  })()`);
  if (
    !nestedEnabled.hasAdvanced ||
    nestedEnabled.comments !== 4 ||
    nestedEnabled.panel.parentSetupCount !== 1 ||
    nestedEnabled.panel.settingsSetupCount !== 1 ||
    nestedEnabled.panel.advancedSetupCount !== 1
  ) {
    throw new Error(`Nested conditional activation failed: ${JSON.stringify(nestedEnabled)}`);
  }

  const nestedReplaced = await evaluate(webSocketUrl, `(() => {
    const oldAdvancedContent = document.querySelector('[data-testid="advanced-content"]');
    document.querySelector('[data-testid="advanced-toggle"]').click();
    const disabled = {
      panel: window.__ruseactConditionalTest.getObservations(),
      oldDetached: !oldAdvancedContent.isConnected,
      hasAdvanced: document.querySelector('[data-testid="advanced-content"]') !== null,
    };
    document.querySelector('[data-testid="advanced-toggle"]').click();
    return {
      disabled,
      panel: window.__ruseactConditionalTest.getObservations(),
      freshAdvanced: document.querySelector('[data-testid="advanced-content"]') !== oldAdvancedContent,
    };
  })()`);
  if (
    !nestedReplaced.disabled.oldDetached ||
    nestedReplaced.disabled.hasAdvanced ||
    nestedReplaced.disabled.panel.advancedSetupCount !== 1 ||
    !nestedReplaced.freshAdvanced ||
    nestedReplaced.panel.advancedSetupCount !== 2 ||
    nestedReplaced.panel.parentSetupCount !== 1
  ) {
    throw new Error(`Nested conditional replacement failed: ${JSON.stringify(nestedReplaced)}`);
  }

  const closedConditional = await evaluate(webSocketUrl, `(() => {
    const oldBranchInput = window.__conditionalRefs.branchInput;
    document.querySelector('[data-testid="panel-toggle"]').click();
    return {
      panel: window.__ruseactConditionalTest.getObservations(),
      oldBranchDetached: !oldBranchInput.isConnected,
      comments: (() => {
        const walker = document.createTreeWalker(document.querySelector('#app'), NodeFilter.SHOW_COMMENT);
        let count = 0;
        while (walker.nextNode()) count += 1;
        return count;
      })(),
      hasPanel: document.querySelector('[data-testid="settings-panel"]') !== null,
      persistentStable: window.__conditionalRefs.persistentInput === document.querySelector('[data-testid="persistent-input"]'),
      persistentValue: document.querySelector('[data-testid="persistent-input"]').value,
    };
  })()`);
  const eventCountBeforeDetachedClick = closedConditional.panel.managedEventCount;
  if (
    !closedConditional.oldBranchDetached ||
    closedConditional.comments !== 2 ||
    closedConditional.hasPanel ||
    !closedConditional.persistentStable ||
    closedConditional.persistentValue !== "preserve this value" ||
    closedConditional.panel.settingsSetupCount !== 1 ||
    closedConditional.panel.parentSetupCount !== 1
  ) {
    throw new Error(`Outer conditional cleanup failed: ${JSON.stringify(closedConditional)}`);
  }

  const detachedListener = await evaluate(webSocketUrl, `(() => {
    const before = window.__ruseactConditionalTest.getManagedEventCount();
    window.__conditionalRefs.advancedToggle?.click();
    return {
      before,
      after: window.__ruseactConditionalTest.getManagedEventCount(),
    };
  })()`);
  if (detachedListener.before !== eventCountBeforeDetachedClick || detachedListener.after !== detachedListener.before) {
    throw new Error(`Detached branch listener observation failed: ${JSON.stringify(detachedListener)}`);
  }

  const reopenedConditional = await evaluate(webSocketUrl, `(() => {
    document.querySelector('[data-testid="panel-toggle"]').click();
    const branchInput = document.querySelector('[data-testid="branch-input"]');
    return {
      panel: window.__ruseactConditionalTest.getObservations(),
      freshBranchInput: branchInput !== window.__conditionalRefs.branchInput,
      branchValue: branchInput?.value,
      outerStable: window.__conditionalRefs.outerStart.isConnected && window.__conditionalRefs.outerEnd.isConnected,
      persistentStable: window.__conditionalRefs.persistentInput === document.querySelector('[data-testid="persistent-input"]'),
    };
  })()`);
  if (
    !reopenedConditional.freshBranchInput ||
    reopenedConditional.branchValue !== "Branch-local value" ||
    !reopenedConditional.outerStable ||
    !reopenedConditional.persistentStable ||
    reopenedConditional.panel.settingsSetupCount !== 2 ||
    reopenedConditional.panel.parentSetupCount !== 1 ||
    reopenedConditional.panel.advancedSetupCount !== 2
  ) {
    throw new Error(`Fresh outer branch activation failed: ${JSON.stringify(reopenedConditional)}`);
  }
  await evaluate(webSocketUrl, `window.__conditionalRefs.branchInput = document.querySelector('[data-testid="branch-input"]'); true`);

  const unchangedSelector = await evaluate(webSocketUrl, `(() => new Promise((resolve) => {
    const before = document.querySelector('[data-testid="branch-input"]');
    const mutations = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.querySelector('#app'), { childList: true, subtree: true, attributes: true, characterData: true });
    window.__ruseactConditionalTest.setPanelWithoutFlush(true);
    window.__ruseactConditionalTest.flush();
    setTimeout(() => {
      observer.disconnect();
      const panel = window.__ruseactConditionalTest.getObservations();
      resolve({ mutations: mutations.length, sameBranchInput: before === document.querySelector('[data-testid="branch-input"]'), panel });
    }, 0);
  }))()`);
  if (
    unchangedSelector.mutations !== 0 ||
    !unchangedSelector.sameBranchInput ||
    unchangedSelector.panel.settingsSetupCount !== 2 ||
    unchangedSelector.panel.parentSetupCount !== 1
  ) {
    throw new Error(`Unchanged selector caused unexpected work: ${JSON.stringify(unchangedSelector)}`);
  }

  const beforeExplicitFlush = await evaluate(webSocketUrl, `(() => {
    window.__ruseactConditionalTest.setPanelWithoutFlush(false);
    return {
      panelStillMounted: document.querySelector('[data-testid="settings-panel"]') !== null,
      panel: window.__ruseactConditionalTest.getObservations(),
    };
  })()`);
  if (!beforeExplicitFlush.panelStillMounted || beforeExplicitFlush.panel.panelVisible !== false) {
    throw new Error(`Signal write unexpectedly changed DOM before flush: ${JSON.stringify(beforeExplicitFlush)}`);
  }
  const afterExplicitFlush = await evaluate(webSocketUrl, `(() => {
    window.__ruseactConditionalTest.flush();
    return {
      panelRemoved: document.querySelector('[data-testid="settings-panel"]') === null,
      hasClosedState: document.querySelector('[data-testid="panel-disabled"]') !== null,
    };
  })()`);
  if (!afterExplicitFlush.panelRemoved || !afterExplicitFlush.hasClosedState) {
    throw new Error(`Explicit conditional flush failed: ${JSON.stringify(afterExplicitFlush)}`);
  }

  const conditionalDisposal = await evaluate(webSocketUrl, `(() => {
    document.querySelector('[data-testid="panel-toggle"]').click();
    const oldPanelToggle = document.querySelector('[data-testid="panel-toggle"]');
    const eventCountBefore = window.__ruseactConditionalTest.getManagedEventCount();
    window.__ruseactConditionalTest.dispose();
    window.__ruseactConditionalTest.dispose();
    oldPanelToggle?.click();
    return {
      signalsDisposed: window.__ruseactConditionalTest.isApplicationSignalsDisposed(),
      eventCountBefore,
      eventCountAfter: window.__ruseactConditionalTest.getManagedEventCount(),
      appChildren: document.querySelector('#app').childElementCount,
      statusStillPresent: document.querySelector('[data-status]') !== null,
    };
  })()`);
  if (
    !conditionalDisposal.signalsDisposed ||
    conditionalDisposal.eventCountBefore !== conditionalDisposal.eventCountAfter ||
    conditionalDisposal.appChildren !== 0 ||
    !conditionalDisposal.statusStillPresent
  ) {
    throw new Error(`Conditional application disposal failed: ${JSON.stringify(conditionalDisposal)}`);
  }

  console.log(`Real Chromium consumer verification passed: Hello World, Counter, conditional lazy branches, nested ownership, explicit flush, DOM identity, listener cleanup, and application disposal.`);
} finally {
  await stopProcess(browser);
  await stopProcess(preview);
  if (profile) await rm(profile, { recursive: true, force: true });
}
