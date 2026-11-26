import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/reorderable/App.mjs";
import type { ReactiveCore, SignalHandle } from "ruseact";
import type { ReorderableItem, ReorderableViewContext } from "./examples/reorderable/model";

const demoItems: readonly ReorderableItem[] = [
  { id: 1, title: "Alpha" },
  { id: 2, title: "Bravo" },
  { id: 3, title: "Charlie" },
  { id: 4, title: "Delta" },
];

let applicationRuntime: ReactiveCore | undefined;
let application: Awaited<ReturnType<typeof mountApplication>> | undefined;
let applicationContext: ReorderableViewContext | undefined;
let items: readonly ReorderableItem[] = demoItems;
let nextItemId = 5;
let revisionValue = 0;
let metricsTickValue = 0;
let expandedItemIdValue = -1;
let parentSetupCount = 0;
let itemSetupCount = 0;
let reorderActionCount = 0;
let flushCount = 0;
let managedEventCount = 0;
let detailEventCount = 0;
let ownedSignals: SignalHandle<number | boolean>[] = [];
let applicationSignalsDisposed = false;

const isTest = new URLSearchParams(window.location.search).has("test");

function fail(result: { readonly ok: false; readonly error: { readonly code: string } }): never {
  throw new Error(result.error.code);
}

function createOwnedSignal<T extends number | boolean>(runtime: ReactiveCore, initial: T): SignalHandle<T> {
  const result = runtime.createSignal(initial);
  if (!result.ok) fail(result);
  ownedSignals.push(result.value);
  return result.value;
}

function setSignal<T extends number | boolean>(runtime: ReactiveCore, signal: SignalHandle<T>, value: T): void {
  const result = runtime.set(signal, value);
  if (!result.ok) fail(result);
}

function sameOrder(left: readonly ReorderableItem[], right: readonly ReorderableItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id);
}

function disposeApplicationSignals(): void {
  if (!applicationRuntime || applicationSignalsDisposed) return;
  for (const signal of [...ownedSignals].reverse()) {
    const result = applicationRuntime.disposeSignal(signal);
    if (!result.ok) fail(result);
  }
  ownedSignals = [];
  applicationSignalsDisposed = true;
}

void mountApplication(
  ({ runtime, flush: rootFlush }) => {
    applicationRuntime = runtime;
    const revision = createOwnedSignal(runtime, revisionValue);
    const metricsTick = createOwnedSignal(runtime, metricsTickValue);
    const hasItemsResult = runtime.createSignal(items.length > 0);
    if (!hasItemsResult.ok) fail(hasItemsResult);
    const hasItems = hasItemsResult.value;
    ownedSignals.push(hasItems);
    const expandedItemId = createOwnedSignal(runtime, expandedItemIdValue);

    const flush = (): void => {
      flushCount += 1;
      rootFlush();
    };

    const publish = (reorderAction: boolean, retainedTitleChange: boolean, shouldFlush: boolean): void => {
      revisionValue += 1;
      metricsTickValue += 1;
      if (reorderAction) reorderActionCount += 1;
      setSignal(runtime, revision, revisionValue);
      setSignal(runtime, metricsTick, metricsTickValue);
      setSignal(runtime, hasItems, items.length > 0);
      setSignal(runtime, expandedItemId, expandedItemIdValue);
      if (!shouldFlush) return;
      flush();
      if (retainedTitleChange) flush();
    };

    const updateExpanded = (id: number, shouldFlush: boolean): boolean => {
      expandedItemIdValue = expandedItemIdValue === id ? -1 : id;
      metricsTickValue += 1;
      setSignal(runtime, metricsTick, metricsTickValue);
      setSignal(runtime, expandedItemId, expandedItemIdValue);
      if (shouldFlush) flush();
      return true;
    };

    const reorder = (next: readonly ReorderableItem[], shouldFlush: boolean): boolean => {
      if (sameOrder(items, next)) return false;
      items = next;
      publish(true, false, shouldFlush);
      return true;
    };

    const context: ReorderableViewContext = {
      runtime,
      flush,
      revision,
      metricsTick,
      hasItems,
      expandedItemId,
      getItems: () => items,
      append(title, shouldFlush = true) {
        const trimmed = title.trim();
        if (!trimmed) return false;
        items = [...items, { id: nextItemId, title: trimmed }];
        nextItemId += 1;
        publish(false, false, shouldFlush);
        return true;
      },
      prepend(title, shouldFlush = true) {
        const trimmed = title.trim();
        if (!trimmed) return false;
        items = [{ id: nextItemId, title: trimmed }, ...items];
        nextItemId += 1;
        publish(false, false, shouldFlush);
        return true;
      },
      moveUp(id, shouldFlush = true) {
        const index = items.findIndex((item) => item.id === id);
        if (index <= 0) return false;
        const next = [...items];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        return reorder(next, shouldFlush);
      },
      moveDown(id, shouldFlush = true) {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0 || index >= items.length - 1) return false;
        const next = [...items];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        return reorder(next, shouldFlush);
      },
      moveFirst(id, shouldFlush = true) {
        const index = items.findIndex((item) => item.id === id);
        if (index <= 0) return false;
        return reorder([items[index], ...items.slice(0, index), ...items.slice(index + 1)], shouldFlush);
      },
      moveLast(id, shouldFlush = true) {
        const index = items.findIndex((item) => item.id === id);
        if (index < 0 || index >= items.length - 1) return false;
        return reorder([...items.slice(0, index), ...items.slice(index + 1), items[index]], shouldFlush);
      },
      reverse(shouldFlush = true) {
        return reorder([...items].reverse(), shouldFlush);
      },
      shuffle(shouldFlush = true) {
        if (items.length < 2) return false;
        const next = [...items];
        for (let index = next.length - 1; index > 0; index -= 1) {
          const swapIndex = (index * 7 + 3) % (index + 1);
          [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
        }
        if (sameOrder(items, next)) [next[0], next[1]] = [next[1], next[0]];
        return reorder(next, shouldFlush);
      },
      sortByTitle(shouldFlush = true) {
        return reorder(
          [...items].sort((left, right) => left.title.localeCompare(right.title) || left.id - right.id),
          shouldFlush,
        );
      },
      updateTitle(id, shouldFlush = true) {
        const target = items.find((item) => item.id === id);
        if (!target) return false;
        items = items.map((item) => (item.id === id ? { ...item, title: `${item.title} · updated` } : item));
        publish(false, true, shouldFlush);
        return true;
      },
      remove(id, shouldFlush = true) {
        if (!items.some((item) => item.id === id)) return false;
        items = items.filter((item) => item.id !== id);
        if (expandedItemIdValue === id) expandedItemIdValue = -1;
        publish(false, false, shouldFlush);
        return true;
      },
      clear(shouldFlush = true) {
        if (items.length === 0) return false;
        items = [];
        expandedItemIdValue = -1;
        publish(false, false, shouldFlush);
        return true;
      },
      restoreDemo(shouldFlush = true) {
        items = demoItems.map((item) => ({ ...item, id: nextItemId++ }));
        expandedItemIdValue = -1;
        publish(false, false, shouldFlush);
        return true;
      },
      toggleExpanded(id, shouldFlush = true) {
        if (!items.some((item) => item.id === id)) return false;
        return updateExpanded(id, shouldFlush);
      },
      onParentSetup: () => {
        parentSetupCount += 1;
      },
      onItemSetup: () => {
        itemSetupCount += 1;
      },
      onManagedEvent: () => {
        managedEventCount += 1;
      },
      onDetailEvent: () => {
        detailEventCount += 1;
      },
      getParentSetupCount: () => parentSetupCount,
      getItemSetupCount: () => itemSetupCount,
      getReorderActionCount: () => reorderActionCount,
      getFlushCount: () => flushCount,
      getDetailEventCount: () => detailEventCount,
    };

    applicationContext = context;
    return createView(context);
  },
  disposeApplicationSignals,
)
  .then((mounted) => {
    application = mounted;
    if (!isTest) return;
    const globalWindow = window as Window & {
      __ruseactReorderableTest?: {
        getSnapshot(): {
          readonly items: readonly ReorderableItem[];
          readonly expandedItemId: number;
          readonly parentSetupCount: number;
          readonly itemSetupCount: number;
          readonly reorderActionCount: number;
          readonly flushCount: number;
          readonly managedEventCount: number;
          readonly detailEventCount: number;
        };
        append(title: string): boolean;
        prepend(title: string): boolean;
        moveUp(id: number): boolean;
        moveDown(id: number): boolean;
        moveFirst(id: number): boolean;
        moveLast(id: number): boolean;
        reverse(): boolean;
        shuffle(): boolean;
        sort(): boolean;
        updateTitle(id: number): boolean;
        remove(id: number): boolean;
        clear(): boolean;
        restoreDemo(): boolean;
        toggleExpanded(id: number): boolean;
        setWithoutFlush(operation: string, id?: number): boolean;
        flush(): void;
        dispose(): void;
        isApplicationSignalsDisposed(): boolean;
      };
    };
    const requireContext = (): ReorderableViewContext => {
      if (!applicationContext) throw new Error("Reorderable application is not mounted.");
      return applicationContext;
    };
    globalWindow.__ruseactReorderableTest = {
      getSnapshot() {
        const context = requireContext();
        return {
          items,
          expandedItemId: expandedItemIdValue,
          parentSetupCount: context.getParentSetupCount(),
          itemSetupCount: context.getItemSetupCount(),
          reorderActionCount: context.getReorderActionCount(),
          flushCount: context.getFlushCount(),
          managedEventCount,
          detailEventCount: context.getDetailEventCount(),
        };
      },
      append(title) { return requireContext().append(title); },
      prepend(title) { return requireContext().prepend(title); },
      moveUp(id) { return requireContext().moveUp(id); },
      moveDown(id) { return requireContext().moveDown(id); },
      moveFirst(id) { return requireContext().moveFirst(id); },
      moveLast(id) { return requireContext().moveLast(id); },
      reverse() { return requireContext().reverse(); },
      shuffle() { return requireContext().shuffle(); },
      sort() { return requireContext().sortByTitle(); },
      updateTitle(id) { return requireContext().updateTitle(id); },
      remove(id) { return requireContext().remove(id); },
      clear() { return requireContext().clear(); },
      restoreDemo() { return requireContext().restoreDemo(); },
      toggleExpanded(id) { return requireContext().toggleExpanded(id); },
      setWithoutFlush(operation, id) {
        const context = requireContext();
        if (operation === "moveUp" && id !== undefined) return context.moveUp(id, false);
        if (operation === "moveDown" && id !== undefined) return context.moveDown(id, false);
        if (operation === "updateTitle" && id !== undefined) return context.updateTitle(id, false);
        if (operation === "expand" && id !== undefined) return context.toggleExpanded(id, false);
        return false;
      },
      flush() { requireContext().flush(); },
      dispose() { application?.dispose(); },
      isApplicationSignalsDisposed() { return applicationSignalsDisposed; },
    };
  })
  .catch(reportApplicationError);
