import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/conditional/App.mjs";
import type { ReactiveCore, SignalHandle } from "ruseact";

let applicationRuntime: ReactiveCore | undefined;
let panelVisible: SignalHandle<boolean> | undefined;
let advancedVisible: SignalHandle<boolean> | undefined;
let application: Awaited<ReturnType<typeof mountApplication>> | undefined;
let parentSetupCount = 0;
let settingsSetupCount = 0;
let advancedSetupCount = 0;
let managedEventCount = 0;
let applicationSignalsDisposed = false;

const isTest = new URLSearchParams(window.location.search).has("test");

void mountApplication(
  ({ runtime, flush }) => {
    applicationRuntime = runtime;
    const panelResult = runtime.createSignal(false);
    if (!panelResult.ok) throw new Error(panelResult.error.code);
    panelVisible = panelResult.value;

    const advancedResult = runtime.createSignal(false);
    if (!advancedResult.ok) throw new Error(advancedResult.error.code);
    advancedVisible = advancedResult.value;

    return createView({
      runtime,
      flush,
      panelVisible,
      advancedVisible,
      onParentSetup: () => {
        parentSetupCount += 1;
      },
      onSettingsSetup: () => {
        settingsSetupCount += 1;
      },
      onAdvancedSetup: () => {
        advancedSetupCount += 1;
      },
      onManagedEvent: () => {
        managedEventCount += 1;
      },
    });
  },
  () => {
    if (!applicationRuntime) return;
    for (const signal of [advancedVisible, panelVisible]) {
      if (!signal) continue;
      const result = applicationRuntime.disposeSignal(signal);
      if (!result.ok) throw new Error(result.error.code);
    }
    advancedVisible = undefined;
    panelVisible = undefined;
    applicationSignalsDisposed = true;
  },
)
  .then((mounted) => {
    application = mounted;
    if (!isTest) return;
    const globalWindow = window as Window & {
      __ruseactConditionalTest?: {
        setPanelWithoutFlush(value: boolean): void;
        setAdvancedWithoutFlush(value: boolean): void;
        flush(): void;
        getObservations(): {
          parentSetupCount: number;
          settingsSetupCount: number;
          advancedSetupCount: number;
          managedEventCount: number;
          panelVisible: boolean;
          advancedVisible: boolean;
        };
        getManagedEventCount(): number;
        isApplicationSignalsDisposed(): boolean;
        dispose(): void;
      };
    };
    globalWindow.__ruseactConditionalTest = {
      setPanelWithoutFlush(value) {
        if (!applicationRuntime || !panelVisible) throw new Error("Conditional playground is not mounted.");
        const result = applicationRuntime.set(panelVisible, value);
        if (!result.ok) throw new Error(result.error.code);
      },
      setAdvancedWithoutFlush(value) {
        if (!applicationRuntime || !advancedVisible) throw new Error("Conditional playground is not mounted.");
        const result = applicationRuntime.set(advancedVisible, value);
        if (!result.ok) throw new Error(result.error.code);
      },
      flush() {
        const result = application?.root.flush();
        if (!result?.ok) throw new Error(JSON.stringify(result?.error ?? { code: "conditional_flush_failed" }));
      },
      getObservations() {
        if (!applicationRuntime || !panelVisible || !advancedVisible) throw new Error("Conditional playground is not mounted.");
        const panelResult = applicationRuntime.get(panelVisible);
        if (!panelResult.ok) throw new Error(panelResult.error.code);
        const advancedResult = applicationRuntime.get(advancedVisible);
        if (!advancedResult.ok) throw new Error(advancedResult.error.code);
        return {
          parentSetupCount,
          settingsSetupCount,
          advancedSetupCount,
          managedEventCount,
          panelVisible: panelResult.value,
          advancedVisible: advancedResult.value,
        };
      },
      getManagedEventCount() {
        return managedEventCount;
      },
      isApplicationSignalsDisposed() {
        return applicationSignalsDisposed;
      },
      dispose() {
        application?.dispose();
      },
    };
  })
  .catch(reportApplicationError);
