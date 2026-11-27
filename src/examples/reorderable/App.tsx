import type { CoreResult, ReactiveCore, SignalHandle } from "ruseact";
import { defineComponent, type KeyedItemEnvironment, type RendererResult } from "ruseact-dom";
import type { ReorderableViewContext } from "./model";

type ComponentTag = (props?: Record<string, unknown>) => unknown;

function readTaskKey(runtime: ReactiveCore, signal: SignalHandle<number>): CoreResult<number> {
  return runtime.get(signal);
}

function readTaskKeyAttribute(runtime: ReactiveCore, signal: SignalHandle<number>): CoreResult<string> {
  const result = readTaskKey(runtime, signal);
  if (!result.ok) return result;
  return { ok: true, value: String(result.value) };
}

function readExpanded(
  runtime: ReactiveCore,
  expandedItemId: SignalHandle<number>,
  taskKey: SignalHandle<number>,
): RendererResult<boolean> {
  const expanded = runtime.get(expandedItemId);
  if (!expanded.ok) return expanded;
  const key = runtime.get(taskKey);
  if (!key.ok) return key;
  return { ok: true, value: expanded.value === key.value };
}

function readExpandedLabel(
  runtime: ReactiveCore,
  expandedItemId: SignalHandle<number>,
  taskKey: SignalHandle<number>,
): CoreResult<string> {
  const result = readExpanded(runtime, expandedItemId, taskKey);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? "Collapse details" : "Expand details" };
}

function readMetric(runtime: ReactiveCore, tick: SignalHandle<number>, value: () => string): CoreResult<string> {
  const result = runtime.get(tick);
  if (!result.ok) return result;
  return { ok: true, value: value() };
}

function formInput(event: Event): HTMLInputElement | undefined {
  const form = event.currentTarget as HTMLFormElement;
  return form.querySelector<HTMLInputElement>("[data-testid=reorder-input]") ?? undefined;
}

export function createView(view: ReorderableViewContext): unknown {
  const Metrics = defineComponent("ReorderableMetrics", () => ({
    ok: true,
    value: (
      <section class="reorder-metrics" data-testid="reorder-metrics" aria-labelledby="reorder-metrics-title">
        <p class="eyebrow">Observable identity notes</p>
        <h2 id="reorder-metrics-title">What stays the same?</h2>
        <dl>
          <dt>Parent setup calls</dt>
          <dd data-testid="reorder-parent-setups">
            {ruseact.bindText([view.metricsTick], ({ runtime: currentRuntime }) =>
              readMetric(currentRuntime, view.metricsTick, () => String(view.getParentSetupCount())))}
          </dd>
          <dt>Total item setup calls</dt>
          <dd data-testid="reorder-item-setups">
            {ruseact.bindText([view.metricsTick], ({ runtime: currentRuntime }) =>
              readMetric(currentRuntime, view.metricsTick, () => String(view.getItemSetupCount())))}
          </dd>
          <dt>Reorder actions</dt>
          <dd data-testid="reorder-action-count">
            {ruseact.bindText([view.metricsTick], ({ runtime: currentRuntime }) =>
              readMetric(currentRuntime, view.metricsTick, () => String(view.getReorderActionCount())))}
          </dd>
          <dt>Explicit flush calls</dt>
          <dd data-testid="reorder-flush-count">
            {ruseact.bindText([view.metricsTick], ({ runtime: currentRuntime }) =>
              readMetric(currentRuntime, view.metricsTick, () => String(view.getFlushCount())))}
          </dd>
          <dt>Current ordered keys</dt>
          <dd data-testid="reorder-order">
            {ruseact.bindText([view.metricsTick], ({ runtime: currentRuntime }) =>
              readMetric(currentRuntime, view.metricsTick, () => view.getItems().map((item) => item.id).join(" → ") || "empty"))}
          </dd>
        </dl>
      </section>
    ),
  })) as unknown as ComponentTag;

  const EmptyState = defineComponent("ReorderableEmptyState", () => ({
    ok: true,
    value: <p class="reorder-empty" data-testid="reorder-empty">The list is empty. Restore the demo to create fresh keys.</p>,
  })) as unknown as ComponentTag;

  const Detail = defineComponent("ReorderableDetail", (props) => {
    const taskKey = props.taskKey as SignalHandle<number>;
    const key = readTaskKey(view.runtime, taskKey);
    if (!key.ok) throw new Error(key.error.code);
    return {
      ok: true,
      value: (
        <div class="reorder-detail" data-testid="reorder-detail">
          <p>
            This detail branch belongs to item {ruseact.bindText([taskKey], ({ runtime: currentRuntime }) =>
              readTaskKey(currentRuntime, taskKey))} and moves with its owner.
          </p>
          <button
            type="button"
            data-testid="reorder-detail-action"
            onClick={() => {
              view.onManagedEvent();
              view.onDetailEvent();
            }}
          >
            Record detail interaction
          </button>
        </div>
      ),
    };
  }) as unknown as ComponentTag;

  const ReorderableItem = defineComponent("ReorderableItem", (props) => {
    const taskKey = props.taskKey as SignalHandle<number>;
    const title = props.title as SignalHandle<string>;
    const setupKey = readTaskKey(view.runtime, taskKey);
    if (!setupKey.ok) throw new Error(setupKey.error.code);
    view.onItemSetup(setupKey.value);

    const currentTaskKey = (): number => {
      const result = readTaskKey(view.runtime, taskKey);
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };

    return {
      ok: true,
      value: (
        <li
          class="reorder-item"
          data-testid="reorder-item"
          data-task-key={ruseact.bindAttribute(
            [taskKey],
            ({ runtime: currentRuntime }) => readTaskKeyAttribute(currentRuntime, taskKey),
          )}
        >
          <div class="reorder-item-header">
            <span class="reorder-key" data-testid="reorder-key">
              Key {ruseact.bindText([taskKey], ({ runtime: currentRuntime }) => readTaskKey(currentRuntime, taskKey))}
            </span>
            <span class="reorder-title" data-testid="reorder-title">
              {ruseact.bindText([title], ({ runtime: currentRuntime }) => currentRuntime.get(title))}
            </span>
          </div>

          <div class="reorder-native-state">
            <label>
              Uncontrolled text
              <input data-testid="reorder-local-input" type="text" value="Local draft" />
            </label>
            <label class="reorder-check-label">
              <input data-testid="reorder-local-check" type="checkbox" checked={false} />
              Uncontrolled check
            </label>
          </div>

          <div class="reorder-item-controls" aria-label="Item movement controls">
            <button type="button" data-testid="reorder-up" onClick={() => { view.onManagedEvent(); view.moveUp(currentTaskKey()); }}>
              Move up
            </button>
            <button type="button" data-testid="reorder-down" onClick={() => { view.onManagedEvent(); view.moveDown(currentTaskKey()); }}>
              Move down
            </button>
            <button type="button" data-testid="reorder-first" onClick={() => { view.onManagedEvent(); view.moveFirst(currentTaskKey()); }}>
              Move first
            </button>
            <button type="button" data-testid="reorder-last" onClick={() => { view.onManagedEvent(); view.moveLast(currentTaskKey()); }}>
              Move last
            </button>
            <button type="button" data-testid="reorder-title-update" onClick={() => { view.onManagedEvent(); view.updateTitle(currentTaskKey()); }}>
              Update title
            </button>
            <button type="button" data-testid="reorder-expand" onClick={() => { view.onManagedEvent(); view.toggleExpanded(currentTaskKey()); }}>
              {ruseact.bindText(
                [view.expandedItemId, taskKey],
                ({ runtime: currentRuntime }) => readExpandedLabel(currentRuntime, view.expandedItemId, taskKey),
              )}
            </button>
            <button type="button" data-testid="reorder-remove" onClick={() => { view.onManagedEvent(); view.remove(currentTaskKey()); }}>
              Remove
            </button>
          </div>

          {ruseact.conditional(
            [view.expandedItemId],
            ({ runtime: currentRuntime }) => readExpanded(currentRuntime, view.expandedItemId, taskKey),
            () => <Detail taskKey={taskKey} />,
            () => null,
          )}
        </li>
      ),
    };
  }) as unknown as ComponentTag;

  const ReorderableApplication = defineComponent("ReorderableApplication", () => {
    view.onParentSetup();
    return {
      ok: true,
      value: (
        <main class="example-page">
          <nav class="site-nav" aria-label="Example navigation">
            <a class="brand" href="/"><span class="brand-mark">R</span> Ruseact</a>
            <span class="page-index">Example 05 / 05</span>
          </nav>
          <section class="example-card reorder-card" aria-labelledby="reorder-title">
            <p class="eyebrow">Version 4 native keyed movement</p>
            <h1 id="reorder-title">Reorderable List</h1>
            <p>
              Move retained item ranges through the browser DOM while observing component setup, renderer-owned
              signals, uncontrolled inputs, focus, and nested branch lifetimes.
            </p>

            <form class="reorder-form" data-testid="reorder-form" onSubmit={(event: Event) => {
              event.preventDefault();
              view.onManagedEvent();
              const input = formInput(event);
              if (input && view.append(input.value)) input.value = "";
            }}>
              <label for="reorder-input">New item</label>
              <div class="reorder-create-row">
                <input id="reorder-input" data-testid="reorder-input" type="text" value="" autocomplete="off" />
                <button type="submit" data-testid="reorder-append">Append</button>
                <button
                  type="button"
                  data-testid="reorder-prepend"
                  onClick={() => {
                    view.onManagedEvent();
                    const input = document.querySelector<HTMLInputElement>("[data-testid=reorder-input]");
                    if (input && view.prepend(input.value)) input.value = "";
                  }}
                >
                  Prepend
                </button>
              </div>
            </form>

            <div class="reorder-toolbar" aria-label="List operations">
              <button type="button" data-testid="reorder-reverse" onClick={() => { view.onManagedEvent(); view.reverse(); }}>
                Reverse
              </button>
              <button type="button" data-testid="reorder-shuffle" onClick={() => { view.onManagedEvent(); view.shuffle(); }}>
                Shuffle
              </button>
              <button type="button" data-testid="reorder-sort" onClick={() => { view.onManagedEvent(); view.sortByTitle(); }}>
                Sort by title
              </button>
              <button type="button" data-testid="reorder-clear" onClick={() => { view.onManagedEvent(); view.clear(); }}>
                Clear
              </button>
              <button type="button" data-testid="reorder-restore" onClick={() => { view.onManagedEvent(); view.restoreDemo(); }}>
                Restore demo
              </button>
            </div>

            <ul class="reorder-list" data-testid="reorder-list">
              {ruseact.keyed(
                [view.revision],
                ({ runtime: currentRuntime }) => ({
                  ok: true,
                  value: view.getItems().map((item) => ({
                    key: item.id,
                    fields: { taskKey: item.id, title: item.title },
                  })),
                }),
                ({ fields }: KeyedItemEnvironment) =>
                  <ReorderableItem taskKey={fields.taskKey} title={fields.title} />
                ,
              )}
            </ul>

            {ruseact.conditional(
              [view.hasItems],
              ({ runtime: currentRuntime }) => currentRuntime.get(view.hasItems),
              () => null,
              () => <EmptyState />,
            )}

            <Metrics />
            <p class="manual-flush-note" data-testid="reorder-flush-note">
              Movement changes the JavaScript order and calls root.flush(). No application code moves DOM nodes or
              restores browser focus and selection.
            </p>
            <p class="source-note">Explore <a href="https://github.com/MaduroLabs/ruseact-example/blob/main/src/examples/reorderable/App.tsx">the Reorderable List source</a>. Focus and selection notes describe tested Chromium behavior, not a universal guarantee.</p>
            <a href="/">Back to examples</a>
          </section>
        </main>
      ),
    };
  }) as unknown as ComponentTag;

  return <ReorderableApplication />;
}
