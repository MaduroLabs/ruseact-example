import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const chromium = process.env.CHROMIUM ?? "chromium";
const previewDirectory = process.env.RUSEACT_TEST_DIST ?? "dist-test";

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

const preview = start(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--outDir", previewDirectory, "--host", "127.0.0.1", "--port", "4173", "--strictPort"]);
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

  await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/todo.html?test=1"; true`);
  const todoPage = await waitForPage(webSocketUrl, "Todo Application");
  if (!todoPage.text.includes("Todo Application")) {
    throw new Error(`Todo Application mount failed: ${JSON.stringify(todoPage)}`);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

  const initialTodo = await evaluate(webSocketUrl, `(() => {
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    window.__todoRefs = Object.fromEntries(items.map((item) => [item.getAttribute('data-task-key'), item]));
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      titles: items.map((item) => item.querySelector('.todo-title')?.textContent?.trim()),
      checked: items.map((item) => item.querySelector('input[type="checkbox"]')?.checked),
      summary: [
        document.querySelector('[data-testid="total-count"]')?.textContent?.trim(),
        document.querySelector('[data-testid="active-count"]')?.textContent?.trim(),
        document.querySelector('[data-testid="completed-count"]')?.textContent?.trim(),
      ],
      parentSetupCount: window.__ruseactTodoTest.getSnapshot().parentSetupCount,
      itemSetupCount: window.__ruseactTodoTest.getSnapshot().itemSetupCount,
      empty: document.querySelector('[data-testid="todo-empty"]') !== null,
    };
  })()`);
  if (
    JSON.stringify(initialTodo.ids) !== JSON.stringify([1, 2, 3]) ||
    JSON.stringify(initialTodo.checked) !== JSON.stringify([false, true, false]) ||
    JSON.stringify(initialTodo.summary) !== JSON.stringify(["3", "2", "1"]) ||
    initialTodo.parentSetupCount !== 1 ||
    initialTodo.itemSetupCount !== 3 ||
    initialTodo.empty
  ) {
    throw new Error(`Initial Todo state failed: ${JSON.stringify(initialTodo)}`);
  }

  const addedTodo = await evaluate(webSocketUrl, `(() => {
    const oldOne = window.__todoRefs['1'];
    const oldThree = window.__todoRefs['3'];
    const input = document.querySelector('[data-testid="todo-input"]');
    input.value = 'Finish the keyed example';
    document.querySelector('[data-testid="todo-add"]').click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    window.__todoRefs = Object.fromEntries(items.map((item) => [item.getAttribute('data-task-key'), item]));
    const snapshot = window.__ruseactTodoTest.getSnapshot();
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retainedOne: oldOne === items.find((item) => item.getAttribute('data-task-key') === '1'),
      retainedThree: oldThree === items.find((item) => item.getAttribute('data-task-key') === '3'),
      title: items.find((item) => item.getAttribute('data-task-key') === '4')?.querySelector('.todo-title')?.textContent?.trim(),
      snapshot,
    };
  })()`);
  if (
    JSON.stringify(addedTodo.ids) !== JSON.stringify([1, 2, 3, 4]) ||
    !addedTodo.retainedOne ||
    !addedTodo.retainedThree ||
    addedTodo.title !== "Finish the keyed example" ||
    addedTodo.snapshot.todos.length !== 4
  ) {
    throw new Error(`Todo insertion or retained identity failed: ${JSON.stringify(addedTodo)}`);
  }

  const whitespaceRejected = await evaluate(webSocketUrl, `(() => {
    const input = document.querySelector('[data-testid="todo-input"]');
    input.value = '   ';
    document.querySelector('[data-testid="todo-add"]').click();
    return window.__ruseactTodoTest.getSnapshot().todos.length;
  })()`);
  if (whitespaceRejected !== 4) throw new Error(`Whitespace task was not rejected: ${whitespaceRejected}`);

  await evaluate(webSocketUrl, `(() => {
    const input = document.querySelector('[data-testid="todo-input"]');
    input.value = 'Keyboard-created task';
    input.focus();
    return true;
  })()`);
  await sendCommand(webSocketUrl, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sendCommand(webSocketUrl, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  const keyboardTodo = await evaluate(webSocketUrl, `(() => {
    const snapshot = window.__ruseactTodoTest.getSnapshot();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    window.__todoRefs = Object.fromEntries(items.map((item) => [item.getAttribute('data-task-key'), item]));
    return { ids: items.map((item) => Number(item.getAttribute('data-task-key'))), snapshot };
  })()`);
  if (JSON.stringify(keyboardTodo.ids) !== JSON.stringify([1, 2, 3, 4, 5]) || keyboardTodo.snapshot.todos.length !== 5) {
    throw new Error(`Keyboard task submission failed: ${JSON.stringify(keyboardTodo)}`);
  }

  const toggledTodo = await evaluate(webSocketUrl, `(() => {
    const item = window.__todoRefs['1'];
    const title = item.querySelector('.todo-title');
    item.querySelector('input[type="checkbox"]').click();
    return {
      sameItem: item === document.querySelector('[data-testid="todo-item"][data-task-key="1"]'),
      sameTitle: title === document.querySelector('[data-testid="todo-item"][data-task-key="1"] .todo-title'),
      checked: item.querySelector('input[type="checkbox"]').checked,
      completedClass: item.classList.contains('is-completed'),
      itemSetupCount: window.__ruseactTodoTest.getSnapshot().itemSetupCount,
    };
  })()`);
  if (!toggledTodo.sameItem || !toggledTodo.sameTitle || !toggledTodo.checked || !toggledTodo.completedClass || toggledTodo.itemSetupCount !== 5) {
    throw new Error(`Retained completion update failed: ${JSON.stringify(toggledTodo)}`);
  }

  const editStarted = await evaluate(webSocketUrl, `(() => {
    const item = window.__todoRefs['1'];
    item.querySelector('[data-testid="todo-edit"]').click();
    return {
      sameItem: item === document.querySelector('[data-testid="todo-item"][data-task-key="1"]'),
      editorValue: document.querySelector('[data-testid="todo-edit-input"]')?.value,
      itemSetupCount: window.__ruseactTodoTest.getSnapshot().itemSetupCount,
    };
  })()`);
  if (!editStarted.sameItem || editStarted.editorValue !== "Read the Ruseact docs" || editStarted.itemSetupCount !== 5) {
    throw new Error(`Todo edit activation failed: ${JSON.stringify(editStarted)}`);
  }

  const editSaved = await evaluate(webSocketUrl, `(() => {
    const input = document.querySelector('[data-testid="todo-edit-input"]');
    input.value = 'Read the retained item docs';
    document.querySelector('[data-testid="todo-save"]').click();
    const item = document.querySelector('[data-testid="todo-item"][data-task-key="1"]');
    return {
      title: item.querySelector('.todo-title')?.textContent?.trim(),
      sameItem: item === window.__todoRefs['1'],
      editorRemoved: document.querySelector('[data-testid="todo-edit-input"]') === null,
      itemSetupCount: window.__ruseactTodoTest.getSnapshot().itemSetupCount,
    };
  })()`);
  if (editSaved.title !== "Read the retained item docs" || !editSaved.sameItem || !editSaved.editorRemoved || editSaved.itemSetupCount !== 5) {
    throw new Error(`Retained title edit failed: ${JSON.stringify(editSaved)}`);
  }

  const editCancelled = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="todo-item"][data-task-key="1"]');
    item.querySelector('[data-testid="todo-edit"]').click();
    const input = document.querySelector('[data-testid="todo-edit-input"]');
    input.value = 'This edit is cancelled';
    document.querySelector('[data-testid="todo-cancel"]').click();
    return {
      title: item.querySelector('.todo-title')?.textContent?.trim(),
      editorRemoved: document.querySelector('[data-testid="todo-edit-input"]') === null,
    };
  })()`);
  if (editCancelled.title !== "Read the retained item docs" || !editCancelled.editorRemoved) {
    throw new Error(`Todo edit cancellation failed: ${JSON.stringify(editCancelled)}`);
  }

  const emptyEdit = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="todo-item"][data-task-key="1"]');
    item.querySelector('[data-testid="todo-edit"]').click();
    document.querySelector('[data-testid="todo-edit-input"]').value = '   ';
    document.querySelector('[data-testid="todo-save"]').click();
    const snapshot = window.__ruseactTodoTest.getSnapshot();
    return {
      editorStillMounted: document.querySelector('[data-testid="todo-edit-input"]') !== null,
      title: item.querySelector('[data-testid="todo-edit-input"]')?.value,
      modelTitle: snapshot.todos.find((todo) => todo.id === 1)?.title,
    };
  })()`);
  if (!emptyEdit.editorStillMounted || emptyEdit.title !== "   " || emptyEdit.modelTitle !== "Read the retained item docs") {
    throw new Error(`Empty Todo edit was not rejected: ${JSON.stringify(emptyEdit)}`);
  }
  await evaluate(webSocketUrl, `document.querySelector('[data-testid="todo-cancel"]').click(); true`);

  const removedTodo = await evaluate(webSocketUrl, `(() => {
    const oldItem = window.__todoRefs['4'];
    const oldRemove = oldItem.querySelector('[data-testid="todo-remove"]');
    const eventCountBefore = window.__ruseactTodoTest.getSnapshot().managedEventCount;
    oldRemove.click();
    const eventCountAfterRemoval = window.__ruseactTodoTest.getSnapshot().managedEventCount;
    oldRemove.click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    return {
      oldDetached: !oldItem.isConnected,
      detachedListenerRemoved: window.__ruseactTodoTest.getSnapshot().managedEventCount === eventCountAfterRemoval,
      eventCountAfterRemoval,
      eventCountBefore,
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retainedThree: window.__todoRefs['3'] === items.find((item) => item.getAttribute('data-task-key') === '3'),
    };
  })()`);
  if (
    !removedTodo.oldDetached ||
    !removedTodo.detachedListenerRemoved ||
    removedTodo.eventCountAfterRemoval !== removedTodo.eventCountBefore + 1 ||
    JSON.stringify(removedTodo.ids) !== JSON.stringify([1, 2, 3, 5]) ||
    !removedTodo.retainedThree
  ) {
    throw new Error(`Todo removal or listener cleanup failed: ${JSON.stringify(removedTodo)}`);
  }

  const activeFilter = await evaluate(webSocketUrl, `(() => {
    [...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'Active').click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    const detachedCompleted = !window.__todoRefs['1'].isConnected && !window.__todoRefs['2'].isConnected;
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retainedThree: window.__todoRefs['3'] === items.find((item) => item.getAttribute('data-task-key') === '3'),
      detachedCompleted,
      selected: document.querySelector('.filter-button.is-selected')?.textContent?.trim(),
    };
  })()`);
  if (JSON.stringify(activeFilter.ids) !== JSON.stringify([3, 5]) || !activeFilter.retainedThree || !activeFilter.detachedCompleted || activeFilter.selected !== "Active") {
    throw new Error(`Active filtering failed: ${JSON.stringify(activeFilter)}`);
  }

  const allFilter = await evaluate(webSocketUrl, `(() => {
    [...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'All').click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      freshOne: window.__todoRefs['1'] !== items.find((item) => item.getAttribute('data-task-key') === '1'),
      freshTwo: window.__todoRefs['2'] !== items.find((item) => item.getAttribute('data-task-key') === '2'),
      retainedThree: window.__todoRefs['3'] === items.find((item) => item.getAttribute('data-task-key') === '3'),
      selected: document.querySelector('.filter-button.is-selected')?.textContent?.trim(),
    };
  })()`);
  if (JSON.stringify(allFilter.ids) !== JSON.stringify([1, 2, 3, 5]) || !allFilter.freshOne || !allFilter.freshTwo || !allFilter.retainedThree || allFilter.selected !== "All") {
    throw new Error(`All filtering or fresh activation failed: ${JSON.stringify(allFilter)}`);
  }

  const completedFilter = await evaluate(webSocketUrl, `(() => {
    [...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'Completed').click();
    return {
      ids: [...document.querySelectorAll('[data-testid="todo-item"]')].map((item) => Number(item.getAttribute('data-task-key'))),
      empty: document.querySelector('[data-testid="todo-empty"]') !== null,
    };
  })()`);
  if (JSON.stringify(completedFilter.ids) !== JSON.stringify([1, 2]) || completedFilter.empty) {
    throw new Error(`Completed filtering failed: ${JSON.stringify(completedFilter)}`);
  }
  await evaluate(webSocketUrl, `([...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'All').click(), true)`);

  const reversedTodo = await evaluate(webSocketUrl, `(() => {
    const before = Object.fromEntries([...document.querySelectorAll('[data-testid="todo-item"]')].map((item) => [item.getAttribute('data-task-key'), item]));
    document.querySelector('[data-testid="todo-reverse"]').click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retained: items.every((item) => before[item.getAttribute('data-task-key')] === item),
      modelIds: window.__ruseactTodoTest.getSnapshot().todos.map((todo) => todo.id),
    };
  })()`);
  if (JSON.stringify(reversedTodo.ids) !== JSON.stringify([5, 3, 2, 1]) || JSON.stringify(reversedTodo.modelIds) !== JSON.stringify([5, 3, 2, 1]) || !reversedTodo.retained) {
    throw new Error(`Keyed reverse movement failed: ${JSON.stringify(reversedTodo)}`);
  }

  const clearedTodo = await evaluate(webSocketUrl, `(() => {
    const itemThree = document.querySelector('[data-testid="todo-item"][data-task-key="3"]');
    const itemFive = document.querySelector('[data-testid="todo-item"][data-task-key="5"]');
    document.querySelector('[data-testid="todo-clear-completed"]').click();
    const items = [...document.querySelectorAll('[data-testid="todo-item"]')];
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retainedThree: itemThree === document.querySelector('[data-testid="todo-item"][data-task-key="3"]'),
      retainedFive: itemFive === document.querySelector('[data-testid="todo-item"][data-task-key="5"]'),
      summary: [
        document.querySelector('[data-testid="total-count"]')?.textContent?.trim(),
        document.querySelector('[data-testid="active-count"]')?.textContent?.trim(),
        document.querySelector('[data-testid="completed-count"]')?.textContent?.trim(),
      ],
    };
  })()`);
  if (JSON.stringify(clearedTodo.ids) !== JSON.stringify([5, 3]) || !clearedTodo.retainedThree || !clearedTodo.retainedFive || JSON.stringify(clearedTodo.summary) !== JSON.stringify(["2", "2", "0"])) {
    throw new Error(`Clear completed failed: ${JSON.stringify(clearedTodo)}`);
  }

  const emptyFilter = await evaluate(webSocketUrl, `(() => {
    [...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'Completed').click();
    return {
      listEmpty: document.querySelectorAll('[data-testid="todo-item"]').length === 0,
      hasEmptyState: document.querySelector('[data-testid="todo-empty"]') !== null,
    };
  })()`);
  if (!emptyFilter.listEmpty || !emptyFilter.hasEmptyState) throw new Error(`Conditional empty state failed: ${JSON.stringify(emptyFilter)}`);
  await evaluate(webSocketUrl, `([...document.querySelectorAll('.filter-button')].find((button) => button.textContent.trim() === 'All').click(), true)`);

  const manualFlush = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="todo-item"][data-task-key="3"]');
    const checkbox = item.querySelector('input[type="checkbox"]');
    const before = checkbox.checked;
    window.__ruseactTodoTest.toggleWithoutFlush(3);
    const afterWrite = checkbox.checked;
    window.__ruseactTodoTest.flush();
    const afterStructuralFlush = checkbox.checked;
    window.__ruseactTodoTest.flush();
    const afterFollowUpFlush = checkbox.checked;
    return { before, afterWrite, afterStructuralFlush, afterFollowUpFlush };
  })()`);
  if (manualFlush.before || manualFlush.afterWrite || manualFlush.afterStructuralFlush || !manualFlush.afterFollowUpFlush) {
    throw new Error(`Deferred retained-item flush semantics failed: ${JSON.stringify(manualFlush)}`);
  }
  await evaluate(webSocketUrl, `(() => {
    window.__ruseactTodoTest.toggleWithoutFlush(3);
    window.__ruseactTodoTest.flush();
    window.__ruseactTodoTest.flush();
    return true;
  })()`);

  const nestedItemConditional = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="todo-item"][data-task-key="3"]');
    const setupBefore = window.__ruseactTodoTest.getSnapshot().itemSetupCount;
    item.querySelector('[data-testid="todo-edit"]').click();
    const editor = item.querySelector('[data-testid="todo-editor"]');
    const otherEditor = document.querySelector('[data-testid="todo-item"][data-task-key="5"] [data-testid="todo-editor"]');
    const setupAfter = window.__ruseactTodoTest.getSnapshot().itemSetupCount;
    return { editor: editor !== null, otherEditor: otherEditor !== null, setupBefore, setupAfter };
  })()`);
  if (!nestedItemConditional.editor || nestedItemConditional.otherEditor || nestedItemConditional.setupBefore !== nestedItemConditional.setupAfter) {
    throw new Error(`Nested keyed-item conditional failed: ${JSON.stringify(nestedItemConditional)}`);
  }
  await evaluate(webSocketUrl, `document.querySelector('[data-testid="todo-cancel"]').click(); true`);

  const todoDisposal = await evaluate(webSocketUrl, `(() => {
    const oldButton = document.querySelector('[data-testid="todo-item"][data-task-key="3"] [data-testid="todo-remove"]');
    const eventCountBefore = window.__ruseactTodoTest.getSnapshot().managedEventCount;
    window.__ruseactTodoTest.dispose();
    window.__ruseactTodoTest.dispose();
    oldButton?.click();
    const snapshot = window.__ruseactTodoTest.getSnapshot();
    return {
      signalsDisposed: window.__ruseactTodoTest.isApplicationSignalsDisposed(),
      appChildren: document.querySelector('#app').childElementCount,
      eventCountBefore,
      eventCountAfter: snapshot.managedEventCount,
      statusStillPresent: document.querySelector('[data-status]') !== null,
    };
  })()`);
  if (!todoDisposal.signalsDisposed || todoDisposal.appChildren !== 0 || todoDisposal.eventCountAfter !== todoDisposal.eventCountBefore || !todoDisposal.statusStillPresent) {
    throw new Error(`Todo application disposal failed: ${JSON.stringify(todoDisposal)}`);
  }

  await evaluate(webSocketUrl, `location.href = "http://127.0.0.1:4173/reorderable.html?test=1"; true`);
  const reorderPage = await waitForPage(webSocketUrl, "Reorderable List");
  if (!reorderPage.text.includes("Reorderable List")) {
    throw new Error(`Reorderable List mount failed: ${JSON.stringify(reorderPage)}`);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

  const initialReorder = await evaluate(webSocketUrl, `(() => {
    const items = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    window.__reorderRefs = Object.fromEntries(items.map((item) => [item.getAttribute('data-task-key'), {
      item,
      input: item.querySelector('[data-testid="reorder-local-input"]'),
      check: item.querySelector('[data-testid="reorder-local-check"]'),
    }]));
    const snapshot = window.__ruseactReorderableTest.getSnapshot();
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      setup: snapshot,
      orderText: document.querySelector('[data-testid="reorder-order"]')?.textContent?.trim(),
      hasDetail: document.querySelector('[data-testid="reorder-detail"]') !== null,
      hasEmpty: document.querySelector('[data-testid="reorder-empty"]') !== null,
    };
  })()`);
  if (
    JSON.stringify(initialReorder.ids) !== JSON.stringify([1, 2, 3, 4]) ||
    initialReorder.setup.parentSetupCount !== 1 ||
    initialReorder.setup.itemSetupCount !== 4 ||
    initialReorder.setup.reorderActionCount !== 0 ||
    initialReorder.hasDetail ||
    initialReorder.hasEmpty ||
    initialReorder.orderText !== "1 → 2 → 3 → 4"
  ) {
    throw new Error(`Initial Reorderable List state failed: ${JSON.stringify(initialReorder)}`);
  }

  const reorderFocusObservation = await evaluate(webSocketUrl, `(() => {
    const ref = window.__reorderRefs['3'];
    ref.input.value = 'focused draft';
    ref.check.checked = true;
    ref.input.focus();
    ref.input.setSelectionRange(2, 9, 'forward');
    const beforeSelection = {
      start: ref.input.selectionStart,
      end: ref.input.selectionEnd,
      direction: ref.input.selectionDirection,
    };
    const beforeItem = ref.item;
    window.__ruseactReorderableTest.moveUp(3);
    const afterInput = document.querySelector('[data-testid="reorder-item"][data-task-key="3"] [data-testid="reorder-local-input"]');
    const activeItem = document.activeElement?.closest('[data-testid="reorder-item"]')?.getAttribute('data-task-key') ?? null;
    return {
      ids: [...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => Number(item.getAttribute('data-task-key'))),
      sameItem: beforeItem === document.querySelector('[data-testid="reorder-item"][data-task-key="3"]'),
      sameInput: ref.input === afterInput,
      value: afterInput?.value,
      checked: document.querySelector('[data-testid="reorder-item"][data-task-key="3"] [data-testid="reorder-local-check"]')?.checked,
      activeItem,
      selection: { start: afterInput?.selectionStart ?? null, end: afterInput?.selectionEnd ?? null, direction: afterInput?.selectionDirection ?? null },
      beforeSelection,
    };
  })()`);
  if (
    JSON.stringify(reorderFocusObservation.ids) !== JSON.stringify([1, 3, 2, 4]) ||
    !reorderFocusObservation.sameItem ||
    !reorderFocusObservation.sameInput ||
    reorderFocusObservation.value !== "focused draft" ||
    !reorderFocusObservation.checked
  ) {
    throw new Error(`Focused item movement or native state preservation failed: ${JSON.stringify(reorderFocusObservation)}`);
  }

  const moveDownResult = await evaluate(webSocketUrl, `(() => {
    const before = window.__reorderRefs['3'];
    window.__ruseactReorderableTest.moveDown(3);
    const item = document.querySelector('[data-testid="reorder-item"][data-task-key="3"]');
    return {
      ids: [...document.querySelectorAll('[data-testid="reorder-item"]')].map((node) => Number(node.getAttribute('data-task-key'))),
      sameItem: before.item === item,
      sameInput: before.input === item.querySelector('[data-testid="reorder-local-input"]'),
      value: item.querySelector('[data-testid="reorder-local-input"]')?.value,
      checked: item.querySelector('[data-testid="reorder-local-check"]')?.checked,
    };
  })()`);
  if (JSON.stringify(moveDownResult.ids) !== JSON.stringify([1, 2, 3, 4]) || !moveDownResult.sameItem || !moveDownResult.sameInput || moveDownResult.value !== "focused draft" || !moveDownResult.checked) {
    throw new Error(`Move down retained identity failed: ${JSON.stringify(moveDownResult)}`);
  }

  const firstLastResult = await evaluate(webSocketUrl, `(() => {
    const refs = { ...window.__reorderRefs };
    window.__ruseactReorderableTest.moveFirst(4);
    const first = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    const firstOrder = first.map((item) => Number(item.getAttribute('data-task-key')));
    const firstRetained = first.every((item) => refs[item.getAttribute('data-task-key')].item === item);
    window.__ruseactReorderableTest.moveLast(4);
    const last = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    return {
      firstOrder,
      firstRetained,
      lastOrder: last.map((item) => Number(item.getAttribute('data-task-key'))),
      lastRetained: last.every((item) => refs[item.getAttribute('data-task-key')].item === item),
    };
  })()`);
  if (JSON.stringify(firstLastResult.firstOrder) !== JSON.stringify([4, 1, 2, 3]) || !firstLastResult.firstRetained || JSON.stringify(firstLastResult.lastOrder) !== JSON.stringify([1, 2, 3, 4]) || !firstLastResult.lastRetained) {
    throw new Error(`Move first/last retained identity failed: ${JSON.stringify(firstLastResult)}`);
  }

  const noOpMove = await evaluate(webSocketUrl, `(() => new Promise((resolve) => {
    const before = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    const setupBefore = window.__ruseactReorderableTest.getSnapshot().itemSetupCount;
    const records = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(document.querySelector('[data-testid="reorder-list"]'), { childList: true, subtree: true });
    const moved = window.__ruseactReorderableTest.moveUp(1);
    setTimeout(() => {
      observer.disconnect();
      resolve({ moved, mutations: records.length, sameNodes: before.every((item) => item === document.querySelector('[data-testid="reorder-item"][data-task-key="' + item.getAttribute('data-task-key') + '"]')), setupBefore, setupAfter: window.__ruseactReorderableTest.getSnapshot().itemSetupCount });
    }, 0);
  }))()`);
  if (noOpMove.moved || noOpMove.mutations !== 0 || !noOpMove.sameNodes || noOpMove.setupBefore !== noOpMove.setupAfter) {
    throw new Error(`Boundary no-op movement was not inert: ${JSON.stringify(noOpMove)}`);
  }

  const orderOperations = await evaluate(webSocketUrl, `(() => {
    const refs = Object.fromEntries([...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => [item.getAttribute('data-task-key'), item]));
    window.__ruseactReorderableTest.reverse();
    const reversed = [...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => Number(item.getAttribute('data-task-key')));
    const reversedRetained = [...document.querySelectorAll('[data-testid="reorder-item"]')].every((item) => refs[item.getAttribute('data-task-key')] === item);
    window.__ruseactReorderableTest.sort();
    const sorted = [...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => Number(item.getAttribute('data-task-key')));
    const sortedRetained = [...document.querySelectorAll('[data-testid="reorder-item"]')].every((item) => refs[item.getAttribute('data-task-key')] === item);
    window.__ruseactReorderableTest.shuffle();
    const shuffledItems = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    return {
      reversed,
      reversedRetained,
      sorted,
      sortedRetained,
      shuffled: shuffledItems.map((item) => Number(item.getAttribute('data-task-key'))),
      shuffledRetained: shuffledItems.every((item) => refs[item.getAttribute('data-task-key')] === item),
      actionCount: window.__ruseactReorderableTest.getSnapshot().reorderActionCount,
    };
  })()`);
  if (JSON.stringify(orderOperations.reversed) !== JSON.stringify([4, 3, 2, 1]) || !orderOperations.reversedRetained || JSON.stringify(orderOperations.sorted) !== JSON.stringify([1, 2, 3, 4]) || !orderOperations.sortedRetained || JSON.stringify([...orderOperations.shuffled].sort((a, b) => a - b)) !== JSON.stringify([1, 2, 3, 4]) || !orderOperations.shuffledRetained || orderOperations.actionCount < 7) {
    throw new Error(`Reverse, sort, or shuffle failed: ${JSON.stringify(orderOperations)}`);
  }

  const nestedMove = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="reorder-item"][data-task-key="2"]');
    window.__ruseactReorderableTest.toggleExpanded(2);
    const detail = item.querySelector('[data-testid="reorder-detail"]');
    const detailAction = item.querySelector('[data-testid="reorder-detail-action"]');
    const detailEventsBefore = window.__ruseactReorderableTest.getSnapshot().detailEventCount;
    detailAction.click();
    const beforeOrder = window.__ruseactReorderableTest.getSnapshot().items.map((entry) => entry.id);
    const index = beforeOrder.indexOf(2);
    if (index === 0) window.__ruseactReorderableTest.moveDown(2);
    else window.__ruseactReorderableTest.moveUp(2);
    const movedItem = document.querySelector('[data-testid="reorder-item"][data-task-key="2"]');
    return {
      detailEvents: window.__ruseactReorderableTest.getSnapshot().detailEventCount - detailEventsBefore,
      sameItem: item === movedItem,
      sameDetail: detail === movedItem.querySelector('[data-testid="reorder-detail"]'),
      otherDetail: document.querySelector('[data-testid="reorder-item"][data-task-key="1"] [data-testid="reorder-detail"]') !== null,
    };
  })()`);
  if (nestedMove.detailEvents !== 1 || !nestedMove.sameItem || !nestedMove.sameDetail || nestedMove.otherDetail) {
    throw new Error(`Nested detail movement failed: ${JSON.stringify(nestedMove)}`);
  }

  const nestedRemoval = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="reorder-item"][data-task-key="2"]');
    const detailAction = item.querySelector('[data-testid="reorder-detail-action"]');
    const detailEventsBefore = window.__ruseactReorderableTest.getSnapshot().detailEventCount;
    window.__ruseactReorderableTest.remove(2);
    detailAction.click();
    const remaining = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    return {
      detached: !item.isConnected && !detailAction.isConnected,
      detachedListenerRemoved: window.__ruseactReorderableTest.getSnapshot().detailEventCount === detailEventsBefore,
      ids: remaining.map((node) => Number(node.getAttribute('data-task-key'))),
    };
  })()`);
  if (!nestedRemoval.detached || !nestedRemoval.detachedListenerRemoved || nestedRemoval.ids.includes(2)) {
    throw new Error(`Nested item cleanup failed: ${JSON.stringify(nestedRemoval)}`);
  }

  const inserted = await evaluate(webSocketUrl, `(() => {
    const before = Object.fromEntries([...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => [item.getAttribute('data-task-key'), item]));
    const input = document.querySelector('[data-testid="reorder-input"]');
    input.value = 'Appended control item';
    document.querySelector('[data-testid="reorder-append"]').click();
    input.value = 'Prepended control item';
    document.querySelector('[data-testid="reorder-prepend"]').click();
    const items = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    return {
      ids: items.map((item) => Number(item.getAttribute('data-task-key'))),
      retained: items.filter((item) => before[item.getAttribute('data-task-key')]).every((item) => before[item.getAttribute('data-task-key')] === item),
      appendedTitle: items.find((item) => item.getAttribute('data-task-key') === '5')?.querySelector('[data-testid="reorder-title"]')?.textContent?.trim(),
      prependedTitle: items.find((item) => item.getAttribute('data-task-key') === '6')?.querySelector('[data-testid="reorder-title"]')?.textContent?.trim(),
    };
  })()`);
  if (!inserted.ids.includes(5) || !inserted.ids.includes(6) || inserted.appendedTitle !== "Appended control item" || inserted.prependedTitle !== "Prepended control item" || !inserted.retained) {
    throw new Error(`Reorderable insertion failed: ${JSON.stringify(inserted)}`);
  }

  const retainedUpdate = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="reorder-item"][data-task-key="3"]');
    const input = item.querySelector('[data-testid="reorder-local-input"]');
    const check = item.querySelector('[data-testid="reorder-local-check"]');
    input.value = 'keep this native value';
    check.checked = true;
    const setupBefore = window.__ruseactReorderableTest.getSnapshot().itemSetupCount;
    window.__ruseactReorderableTest.updateTitle(3);
    return {
      title: item.querySelector('[data-testid="reorder-title"]')?.textContent?.trim(),
      sameItem: item === document.querySelector('[data-testid="reorder-item"][data-task-key="3"]'),
      sameInput: input === document.querySelector('[data-testid="reorder-item"][data-task-key="3"] [data-testid="reorder-local-input"]'),
      value: input.value,
      checked: check.checked,
      setupBefore,
      setupAfter: window.__ruseactReorderableTest.getSnapshot().itemSetupCount,
    };
  })()`);
  if (retainedUpdate.title !== "Charlie · updated" || !retainedUpdate.sameItem || !retainedUpdate.sameInput || retainedUpdate.value !== "keep this native value" || !retainedUpdate.checked || retainedUpdate.setupBefore !== retainedUpdate.setupAfter) {
    throw new Error(`Retained title update changed native or component identity: ${JSON.stringify(retainedUpdate)}`);
  }

  const emptyAndRestore = await evaluate(webSocketUrl, `(() => {
    const oldItem = document.querySelector('[data-testid="reorder-item"][data-task-key="3"]');
    const oldRemove = oldItem.querySelector('[data-testid="reorder-remove"]');
    const managedBefore = window.__ruseactReorderableTest.getSnapshot().managedEventCount;
    window.__ruseactReorderableTest.clear();
    oldRemove.click();
    const empty = {
      ids: [...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => Number(item.getAttribute('data-task-key'))),
      hasEmpty: document.querySelector('[data-testid="reorder-empty"]') !== null,
      oldDetached: !oldItem.isConnected,
      oldListenerRemoved: window.__ruseactReorderableTest.getSnapshot().managedEventCount === managedBefore,
    };
    const setupBeforeRestore = window.__ruseactReorderableTest.getSnapshot().itemSetupCount;
    window.__ruseactReorderableTest.restoreDemo();
    const restored = [...document.querySelectorAll('[data-testid="reorder-item"]')];
    return {
      empty,
      restoredIds: restored.map((item) => Number(item.getAttribute('data-task-key'))),
      freshKeys: restored.every((item) => Number(item.getAttribute('data-task-key')) > 6),
      hasEmptyAfterRestore: document.querySelector('[data-testid="reorder-empty"]') !== null,
      setupIncrease: window.__ruseactReorderableTest.getSnapshot().itemSetupCount - setupBeforeRestore,
    };
  })()`);
  if (emptyAndRestore.empty.ids.length !== 0 || !emptyAndRestore.empty.hasEmpty || !emptyAndRestore.empty.oldDetached || !emptyAndRestore.empty.oldListenerRemoved || JSON.stringify(emptyAndRestore.restoredIds) !== JSON.stringify([7, 8, 9, 10]) || !emptyAndRestore.freshKeys || emptyAndRestore.hasEmptyAfterRestore || emptyAndRestore.setupIncrease !== 4) {
    throw new Error(`Empty transition or fresh restore failed: ${JSON.stringify(emptyAndRestore)}`);
  }

  const focusObservations = await evaluate(webSocketUrl, `(() => {
    const observations = {};
    const focusInput = (id, value, start, end) => {
      const input = document.querySelector('[data-testid="reorder-item"][data-task-key="' + id + '"] [data-testid="reorder-local-input"]');
      input.value = value;
      input.focus();
      input.setSelectionRange(start, end, 'forward');
      return input;
    };
    const readFocus = () => ({
      activeKey: document.activeElement?.closest('[data-testid="reorder-item"]')?.getAttribute('data-task-key') ?? null,
      activeIsInput: document.activeElement?.matches('[data-testid="reorder-local-input"]') ?? false,
      selectionStart: document.activeElement?.selectionStart ?? null,
      selectionEnd: document.activeElement?.selectionEnd ?? null,
      selectionDirection: document.activeElement?.selectionDirection ?? null,
    });
    const readInput = (input) => ({
      connected: input.isConnected,
      active: document.activeElement === input,
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectionDirection: input.selectionDirection,
    });
    const item8 = focusInput(8, 'focus eight', 1, 5);
    const moveFocusedBefore = readInput(item8);
    const moveFocusedCheck = document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-check"]');
    moveFocusedCheck.checked = true;
    const moveFocusedBeforeCheck = moveFocusedCheck.checked;
    window.__ruseactReorderableTest.moveFirst(8);
    observations.moveFocused = { before: moveFocusedBefore, after: readInput(item8), beforeCheck: moveFocusedBeforeCheck, afterCheck: moveFocusedCheck.checked, nodePreserved: item8 === document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-input"]'), ...readFocus() };
    const restoredFocusInput = focusInput(8, 'focus eight', 1, 5);
    const restoredFocusCheck = document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-check"]');
    restoredFocusCheck.checked = true;
    const moveAnotherBefore = readInput(restoredFocusInput);
    window.__ruseactReorderableTest.moveFirst(9);
    observations.moveAnother = { before: moveAnotherBefore, after: readInput(restoredFocusInput), beforeCheck: true, afterCheck: restoredFocusCheck.checked, nodePreserved: restoredFocusInput === document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-input"]'), ...readFocus() };
    const focusedForInsert = focusInput(8, 'insert focus', 2, 6);
    const insertBefore = readInput(focusedForInsert);
    window.__ruseactReorderableTest.prepend('Inserted before focus');
    observations.insertBefore = { before: insertBefore, after: readInput(focusedForInsert), nodePreserved: focusedForInsert === document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-input"]'), ...readFocus() };
    const focusedForRemove = focusInput(8, 'remove neighbor', 1, 4);
    const removeUnrelatedBefore = readInput(focusedForRemove);
    window.__ruseactReorderableTest.remove(7);
    observations.removeUnrelated = { before: removeUnrelatedBefore, after: readInput(focusedForRemove), nodePreserved: focusedForRemove === document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-input"]'), ...readFocus() };
    const focusedForUpdate = focusInput(8, 'update focus', 1, 3);
    const retainedUpdateBefore = readInput(focusedForUpdate);
    window.__ruseactReorderableTest.updateTitle(8);
    observations.retainedUpdate = { before: retainedUpdateBefore, after: readInput(focusedForUpdate), nodePreserved: focusedForUpdate === document.querySelector('[data-testid="reorder-item"][data-task-key="8"] [data-testid="reorder-local-input"]'), ...readFocus() };
    const focusedForRemoval = focusInput(8, 'removed focus', 1, 3);
    const removeFocusedBefore = readInput(focusedForRemoval);
    window.__ruseactReorderableTest.remove(8);
    observations.removeFocused = { before: removeFocusedBefore, after: readInput(focusedForRemoval), ...readFocus() };
    return observations;
  })()`);
  for (const observation of Object.values(focusObservations)) {
    if (!observation.nodePreserved && observation.nodePreserved !== undefined && observation.nodePreserved !== true) {
      throw new Error(`Focus observation lost native node identity: ${JSON.stringify(focusObservations)}`);
    }
  }

  const manualReorderFlush = await evaluate(webSocketUrl, `(() => {
    const item = document.querySelector('[data-testid="reorder-item"][data-task-key="9"]');
    const beforeTitle = item.querySelector('[data-testid="reorder-title"]')?.textContent?.trim();
    const beforeNode = item;
    window.__ruseactReorderableTest.setWithoutFlush('updateTitle', 9);
    const afterWrite = item.querySelector('[data-testid="reorder-title"]')?.textContent?.trim();
    window.__ruseactReorderableTest.flush();
    const afterFirstFlush = item.querySelector('[data-testid="reorder-title"]')?.textContent?.trim();
    window.__ruseactReorderableTest.flush();
    const afterFollowUpFlush = item.querySelector('[data-testid="reorder-title"]')?.textContent?.trim();
    return { beforeTitle, afterWrite, afterFirstFlush, afterFollowUpFlush, sameNode: beforeNode === document.querySelector('[data-testid="reorder-item"][data-task-key="9"]') };
  })()`);
  if (manualReorderFlush.beforeTitle !== manualReorderFlush.afterWrite || manualReorderFlush.afterFirstFlush !== manualReorderFlush.beforeTitle || manualReorderFlush.afterFollowUpFlush === manualReorderFlush.beforeTitle || !manualReorderFlush.sameNode) {
    throw new Error(`Reorderable one-pass flush behavior failed: ${JSON.stringify(manualReorderFlush)}`);
  }

  const stressResult = await evaluate(webSocketUrl, `(() => {
    window.__ruseactReorderableTest.restoreDemo();
    let model = window.__ruseactReorderableTest.getSnapshot().items.map((item) => ({ ...item }));
    const setupAtStart = window.__ruseactReorderableTest.getSnapshot().itemSetupCount;
    const refs = Object.fromEntries([...document.querySelectorAll('[data-testid="reorder-item"]')].map((item) => [item.getAttribute('data-task-key'), item]));
    const assertState = (label) => {
      const actual = window.__ruseactReorderableTest.getSnapshot();
      const actualIds = actual.items.map((item) => item.id);
      const expectedIds = model.map((item) => item.id);
      if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds) || new Set(actualIds).size !== actualIds.length) throw new Error(label + ': model/order mismatch ' + JSON.stringify({ expectedIds, actualIds }));
      for (const item of document.querySelectorAll('[data-testid="reorder-item"]')) {
        const key = item.getAttribute('data-task-key');
        if (refs[key] && refs[key] !== item) throw new Error(label + ': retained node changed for ' + key);
        refs[key] = item;
      }
      return actual;
    };
    const appendId = Math.max(...model.map((item) => item.id)) + 1;
    window.__ruseactReorderableTest.append('Stress append');
    model = [...model, { id: appendId, title: 'Stress append' }];
    assertState('append');
    const prependId = appendId + 1;
    window.__ruseactReorderableTest.prepend('Stress prepend');
    model = [{ id: prependId, title: 'Stress prepend' }, ...model];
    assertState('prepend');
    const moveDownId = model[0].id;
    model = [model[1], model[0], ...model.slice(2)];
    window.__ruseactReorderableTest.moveDown(moveDownId);
    assertState('move down');
    const lastId = model[model.length - 1].id;
    const lastIndex = model.findIndex((item) => item.id === lastId);
    [model[lastIndex - 1], model[lastIndex]] = [model[lastIndex], model[lastIndex - 1]];
    window.__ruseactReorderableTest.moveUp(lastId);
    assertState('move up');
    const first = model[0];
    model = [...model.slice(1), first];
    window.__ruseactReorderableTest.moveLast(first.id);
    assertState('move last');
    model = [...model].reverse();
    window.__ruseactReorderableTest.reverse();
    assertState('reverse');
    const shuffled = [...model];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = (index * 7 + 3) % (index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    if (shuffled.every((item, index) => item.id === model[index].id)) [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    model = shuffled;
    window.__ruseactReorderableTest.shuffle();
    assertState('shuffle');
    model = [...model].sort((left, right) => left.title.localeCompare(right.title) || left.id - right.id);
    window.__ruseactReorderableTest.sort();
    assertState('sort');
    const updateId = model[1].id;
    model = model.map((item) => item.id === updateId ? { ...item, title: item.title + ' · updated' } : item);
    window.__ruseactReorderableTest.updateTitle(updateId);
    assertState('title update');
    const expandedId = model[0].id;
    window.__ruseactReorderableTest.toggleExpanded(expandedId);
    const expanded = document.querySelector('[data-testid="reorder-item"][data-task-key="' + expandedId + '"] [data-testid="reorder-detail"]') !== null;
    const removeId = model[2].id;
    model = model.filter((item) => item.id !== removeId);
    window.__ruseactReorderableTest.remove(removeId);
    const final = assertState('remove');
    return {
      ids: final.items.map((item) => item.id),
      expanded,
      setupAtStart,
      setupAtEnd: final.itemSetupCount,
      expectedSetupIncrease: 2,
      actionCount: final.reorderActionCount,
    };
  })()`);
  if (!stressResult.expanded || stressResult.setupAtEnd !== stressResult.setupAtStart + stressResult.expectedSetupIncrease || new Set(stressResult.ids).size !== stressResult.ids.length || stressResult.actionCount < 6) {
    throw new Error(`Repeated reorder stress regression failed: ${JSON.stringify(stressResult)}`);
  }

  const reorderDisposal = await evaluate(webSocketUrl, `(() => {
    const oldButton = document.querySelector('[data-testid="reorder-item"] [data-testid="reorder-remove"]');
    const snapshotBefore = window.__ruseactReorderableTest.getSnapshot();
    window.__ruseactReorderableTest.dispose();
    window.__ruseactReorderableTest.dispose();
    oldButton?.click();
    const snapshotAfter = window.__ruseactReorderableTest.getSnapshot();
    return {
      signalsDisposed: window.__ruseactReorderableTest.isApplicationSignalsDisposed(),
      appChildren: document.querySelector('#app').childElementCount,
      listenerRemoved: snapshotBefore.managedEventCount === snapshotAfter.managedEventCount,
    };
  })()`);
  if (!reorderDisposal.signalsDisposed || reorderDisposal.appChildren !== 0 || !reorderDisposal.listenerRemoved) {
    throw new Error(`Reorderable application disposal failed: ${JSON.stringify(reorderDisposal)}`);
  }

  console.log(`Real Chromium consumer verification passed: Hello World, Counter, Conditional Playground, Todo, Reorderable List movement, retained DOM/input identity, nested ownership, focus observations, explicit follow-up flushes, cleanup, and repeated reconciliation.`);
  console.log(`Reorderable focus/selection observations: ${JSON.stringify({ firstMove: reorderFocusObservation, scenarios: focusObservations })}`);
} finally {
  await stopProcess(browser);
  await stopProcess(preview);
  if (profile) await rm(profile, { recursive: true, force: true });
}
