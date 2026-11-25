import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/counter/App.mjs";
import type { ReactiveCore, SignalHandle } from "ruseact";

let applicationRuntime: ReactiveCore | undefined;
let count: SignalHandle<number> | undefined;
let application: Awaited<ReturnType<typeof mountApplication>> | undefined;

void mountApplication(
  ({ runtime, flush }) => {
    applicationRuntime = runtime;
    const signalResult = runtime.createSignal(0);
    if (!signalResult.ok) throw new Error(signalResult.error.code);
    count = signalResult.value;
    return createView({ count, runtime, flush });
  },
  () => {
    if (!applicationRuntime || !count) return;
    const result = applicationRuntime.disposeSignal(count);
    if (!result.ok) throw new Error(result.error.code);
    count = undefined;
  },
)
  .then((mounted) => {
    application = mounted;
    const globalWindow = window as Window & {
      __ruseactCounterTest?: {
        setWithoutFlush(value: number): void;
        flush(): void;
      };
    };
    if (new URLSearchParams(window.location.search).has("test")) {
      globalWindow.__ruseactCounterTest = {
        setWithoutFlush(value) {
          if (!applicationRuntime || !count) throw new Error("Counter is not mounted.");
          const result = applicationRuntime.set(count, value);
          if (!result.ok) throw new Error(result.error.code);
        },
        flush() {
          application?.root.flush();
        },
      };
    }
  })
  .catch(reportApplicationError);
