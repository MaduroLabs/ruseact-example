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

  console.log(`Real Chromium consumer verification passed: Hello World, Counter, Conditional Playground, keyed Todo insertion, retained updates, editing, filtering, reordering, cleanup, nested item conditionals, and explicit follow-up flush semantics.`);
} finally {
  await stopProcess(browser);
  await stopProcess(preview);
  if (profile) await rm(profile, { recursive: true, force: true });
}
