import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/counter/App.mjs";
import type { ReactiveCore, SignalHandle } from "ruseact";

let applicationRuntime: ReactiveCore | undefined;
let count: SignalHandle<number> | undefined;
let application: Awaited<ReturnType<typeof mountApplication>> | undefined;
let handledEventCount = 0;
let applicationSignalDisposed = false;
let pageShowPersisted = false;
const isInstrumented = __RUSEACT_INSTRUMENTED__;

if (isInstrumented && new URLSearchParams(window.location.search).has("test")) {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) pageShowPersisted = true;
  });
}

void mountApplication(
  ({ runtime, flush }) => {
    applicationRuntime = runtime;
    const signalResult = runtime.createSignal(0);
    if (!signalResult.ok) throw new Error(signalResult.error.code);
    count = signalResult.value;
    return createView({
      count,
      runtime,
      flush,
      onEvent: () => {
        handledEventCount += 1;
      },
    });
  },
  () => {
    if (!applicationRuntime || !count) return;
    const result = applicationRuntime.disposeSignal(count);
    if (!result.ok) throw new Error(result.error.code);
    count = undefined;
    applicationSignalDisposed = true;
  },
)
  .then((mounted) => {
    application = mounted;
    const globalWindow = window as Window & {
      __ruseactCounterTest?: {
        setWithoutFlush(value: number): void;
        flush(): void;
        dispose(): void;
        getHandledEventCount(): number;
        isApplicationSignalDisposed(): boolean;
        wasPersistedPageShown(): boolean;
      };
    };
    if (isInstrumented && new URLSearchParams(window.location.search).has("test")) {
      globalWindow.__ruseactCounterTest = {
        setWithoutFlush(value) {
          if (!applicationRuntime || !count) throw new Error("Counter is not mounted.");
          const result = applicationRuntime.set(count, value);
          if (!result.ok) throw new Error(result.error.code);
        },
        flush() {
          application?.root.flush();
        },
        dispose() {
          application?.dispose();
        },
        getHandledEventCount() {
          return handledEventCount;
        },
        isApplicationSignalDisposed() {
          return applicationSignalDisposed;
        },
        wasPersistedPageShown() {
          return pageShowPersisted;
        },
      };
    }
  })
  .catch(reportApplicationError);
