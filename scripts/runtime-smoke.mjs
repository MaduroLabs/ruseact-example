import * as wasm from "ruseact/wasm/node";
import { createReactiveCore } from "ruseact";

const runtimeResult = await createReactiveCore(() => wasm);
if (!runtimeResult.ok) throw new Error(`runtime initialization failed: ${runtimeResult.error.code}`);
const runtime = runtimeResult.value;

const signalResult = runtime.createSignal(0);
if (!signalResult.ok) throw new Error(`signal creation failed: ${signalResult.error.code}`);
const signal = signalResult.value;
if (runtime.get(signal).value !== 0) throw new Error("signal read mismatch");
if (!runtime.set(signal, 1).ok) throw new Error("signal write failed");
if (runtime.set(signal, 1).value !== "unchanged") throw new Error("equality-aware write mismatch");

const computationResult = runtime.createComputation();
if (!computationResult.ok) throw new Error(`computation creation failed: ${computationResult.error.code}`);
const computation = computationResult.value;
if (!runtime.replaceDependencies(computation, [signal]).ok) throw new Error("dependency replacement failed");
if (!runtime.subscribe(signal, computation).ok) throw new Error("subscription failed");
if (!runtime.set(signal, 2).ok) throw new Error("second signal write failed");
const pending = runtime.drainPendingComputations();
if (!pending.ok || pending.value.length !== 1 || pending.value[0] !== computation) {
  throw new Error("pending computation identity mismatch");
}
if (!runtime.disposeComputation(computation).ok) throw new Error("computation disposal failed");
if (!runtime.disposeSignal(signal).ok) throw new Error("signal disposal failed");
if (!runtime.dispose().ok) throw new Error("runtime disposal failed");

console.log("Installed Node runtime smoke passed: WASM, scalar equality, dependency, queue, and disposal semantics.");
