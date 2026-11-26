import type { ReactiveCore, SignalHandle } from "ruseact";
import type { ViewDescription } from "ruseact-dom";

export interface CounterViewContext {
  readonly count: SignalHandle<number>;
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
  readonly onEvent?: () => void;
}

function changeCount(
  view: CounterViewContext,
  update: (current: number) => number,
): void {
  view.onEvent?.();
  const currentResult = view.runtime.get(view.count);
  if (!currentResult.ok) throw new Error(currentResult.error.code);
  const setResult = view.runtime.set(view.count, update(currentResult.value));
  if (!setResult.ok) throw new Error(setResult.error.code);
  view.flush();
}

export function createView(view: CounterViewContext): ViewDescription {
  return (
    <main class="example-page">
      <section class="example-card" aria-labelledby="counter-title">
        <p class="eyebrow">Explicit signals and flush</p>
        <h1 id="counter-title">Counter</h1>
        <output class="counter-value" aria-live="polite">
          {ruseact.bindText([view.count], ({ runtime }) => runtime.get(view.count))}
        </output>
        <div class="controls" aria-label="Counter controls">
          <button type="button" onClick={() => changeCount(view, (value) => value - 1)}>
            Decrement
          </button>
          <button type="button" onClick={() => changeCount(view, (value) => value + 1)}>
            Increment
          </button>
          <button type="button" onClick={() => changeCount(view, () => 0)}>
            Reset
          </button>
        </div>
        <p class="manual-flush-note" data-status>
          Each event writes the signal and then calls root.flush() explicitly.
        </p>
        <a href="/">Back to examples</a>
      </section>
    </main>
  );
}
