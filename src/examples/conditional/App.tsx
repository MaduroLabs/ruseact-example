import type { CoreResult, ReactiveCore, SignalHandle } from "ruseact";
import { defineComponent, type RendererResult, type ViewDescription } from "ruseact-dom";

export interface ConditionalViewContext {
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
  readonly panelVisible: SignalHandle<boolean>;
  readonly advancedVisible: SignalHandle<boolean>;
  readonly onParentSetup: () => void;
  readonly onSettingsSetup: () => void;
  readonly onAdvancedSetup: () => void;
  readonly onManagedEvent: () => void;
}

type ComponentTag = (props?: Record<string, unknown>) => unknown;

function readBoolean(
  runtime: ReactiveCore,
  signal: SignalHandle<boolean>,
): RendererResult<boolean> {
  return runtime.get(signal);
}

function readLabel(
  runtime: ReactiveCore,
  signal: SignalHandle<boolean>,
  visibleLabel: string,
  hiddenLabel: string,
): CoreResult<string> {
  const result = runtime.get(signal);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? visibleLabel : hiddenLabel };
}

function toggleSignal(context: ConditionalViewContext, signal: SignalHandle<boolean>): void {
  context.onManagedEvent();
  const current = context.runtime.get(signal);
  if (!current.ok) throw new Error(current.error.code);
  const update = context.runtime.set(signal, !current.value);
  if (!update.ok) throw new Error(update.error.code);
  context.flush();
}

function setSignal(
  context: ConditionalViewContext,
  signal: SignalHandle<boolean>,
  value: boolean,
): void {
  const update = context.runtime.set(signal, value);
  if (!update.ok) throw new Error(update.error.code);
}

export function createView(view: ConditionalViewContext): ViewDescription {
  const AdvancedSettings = defineComponent("ConditionalAdvancedSettings", () => {
    view.onAdvancedSetup();
    return {
      ok: true,
      value: (
        <div class="conditional-advanced" data-testid="advanced-content">
          <h3>Advanced settings</h3>
          <label>
            <input type="checkbox" checked={true} />
            Enable the experimental detail view
          </label>
          <p> This branch has its own component lifetime and DOM range.</p>
        </div>
      ),
    };
  }) as unknown as ComponentTag;

  const SettingsPanel = defineComponent("ConditionalSettingsPanel", (props) => {
    const advanced = props.advancedVisible as SignalHandle<boolean>;
    view.onSettingsSetup();
    return {
      ok: true,
      value: (
        <section class="conditional-panel" data-testid="settings-panel" aria-labelledby="settings-title">
          <p class="eyebrow">Mounted branch</p>
          <h2 id="settings-title">Settings panel</h2>
          <label for="display-name">Display name</label>
          <input id="display-name" data-testid="branch-input" type="text" value="Branch-local value" />
          <button
            type="button"
            data-testid="advanced-toggle"
            onClick={() => toggleSignal(view, advanced)}
          >
            {ruseact.bindText(
              [advanced],
              ({ runtime }) => readLabel(runtime, advanced, "Hide advanced settings", "Show advanced settings"),
            )}
          </button>
          {ruseact.conditional(
            [advanced],
            ({ runtime }) => readBoolean(runtime, advanced),
            () => <AdvancedSettings />,
            () => <p data-testid="advanced-disabled">Advanced settings are closed.</p>,
          )}
        </section>
      ),
    };
  }) as unknown as ComponentTag;

  const PlaygroundShell = defineComponent("ConditionalPlaygroundShell", () => {
    view.onParentSetup();
    return {
      ok: true,
      value: (
        <main class="example-page">
          <section class="example-card" aria-labelledby="conditional-title">
            <p class="eyebrow">Conditional structural rendering</p>
            <h1 id="conditional-title">Conditional Playground</h1>
            <p>Structural updates replace only the selected branch while the parent stays mounted.</p>

            <div class="conditional-controls" aria-label="Conditional playground controls">
              <button
                type="button"
                data-testid="panel-toggle"
                onClick={() => {
                  view.onManagedEvent();
                  const current = view.runtime.get(view.panelVisible);
                  if (!current.ok) throw new Error(current.error.code);
                  setSignal(view, view.panelVisible, !current.value);
                  if (current.value) setSignal(view, view.advancedVisible, false);
                  view.flush();
                }}
              >
                {ruseact.bindText(
                  [view.panelVisible],
                  ({ runtime }) => readLabel(runtime, view.panelVisible, "Hide settings", "Show settings"),
                )}
              </button>
            </div>

            <label class="persistent-field" for="persistent-input">
              Persistent input outside the conditional region
            </label>
            <input id="persistent-input" data-testid="persistent-input" type="text" value="" />

            {ruseact.conditional(
              [view.panelVisible],
              ({ runtime }) => readBoolean(runtime, view.panelVisible),
              () => <SettingsPanel advancedVisible={view.advancedVisible} />,
              () => <p data-testid="panel-disabled">Settings panel is closed.</p>,
            )}

            <section class="observations" data-testid="observations" aria-labelledby="observations-title">
              <p class="eyebrow">Lifecycle observations</p>
              <h2 id="observations-title">What to watch</h2>
              <p>
                Parent setup is one-shot. Each panel opening creates a fresh Settings Panel, and advanced content
                is created only when its selector is true.
              </p>
              <dl>
                <dt>Panel selector</dt>
                <dd>
                  {ruseact.bindText(
                    [view.panelVisible],
                    ({ runtime }) => readLabel(runtime, view.panelVisible, "true", "false"),
                  )}
                </dd>
                <dt>Advanced selector</dt>
                <dd>
                  {ruseact.bindText(
                    [view.advancedVisible],
                    ({ runtime }) => readLabel(runtime, view.advancedVisible, "true", "false"),
                  )}
                </dd>
              </dl>
              <p class="manual-flush-note">Signal writes stay invisible until the application calls root.flush().</p>
            </section>

            <a href="/">Back to examples</a>
          </section>
        </main>
      ),
    };
  }) as unknown as ComponentTag;

  return <PlaygroundShell />;
}
