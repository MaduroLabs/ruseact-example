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
      <nav class="site-nav" aria-label="Example navigation">
        <a class="brand" href="/" aria-label="Ruseact Playground home">
          <span class="brand-mark" aria-hidden="true">
            <span class="brand-mark-line brand-mark-line-long"></span>
            <span class="brand-mark-line brand-mark-line-short"></span>
            <span class="brand-mark-line brand-mark-line-long"></span>
            <span class="brand-mark-dot"></span>
          </span>
          <span>Ruseact Playground</span>
        </a>
        <span class="nav"><a href="/">Examples</a><a href="https://github.com/MaduroLabs/ruseact-example">Source</a><span class="version-note">alpha.1</span></span>
      </nav>
      <section class="example-card" aria-labelledby="counter-title">
        <div class="surface-header"><span class="route">/counter.html</span><span class="surface-label">Preview</span></div>
        <h1 id="counter-title">Counter</h1>
        <p class="example-description">Each event writes one signal and calls root.flush() explicitly.</p>
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
        <p class="source-note">Explore <a href="https://github.com/MaduroLabs/ruseact-example/blob/main/src/examples/counter/App.tsx">the Counter source</a> and try a keyboard-activated control.</p>
        <div class="example-footer"><span>Changed and unchanged signal writes remain explicit.</span><a href="/">All examples</a></div>
      </section>
    </main>
  );
}
