import initializeWasm, * as wasm from "ruseact/wasm/web";
import { createReactiveCore, type ReactiveCore } from "ruseact";
import { createRoot, type RendererRoot, type ViewDescription } from "ruseact-dom";

export interface ApplicationViewContext {
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
}

type CreateView = (context: ApplicationViewContext) => ViewDescription;

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "error" in error) {
    const nested = (error as { error?: unknown }).error;
    if (typeof nested === "object" && nested !== null && "code" in nested) {
      const detail = nested as { code: unknown; operation?: unknown; message?: unknown };
      return `${String(detail.code)}${detail.operation ? ` (${String(detail.operation)})` : ""}${detail.message ? `: ${String(detail.message)}` : ""}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function throwResultError(result: { readonly ok: false; readonly error: unknown }): never {
  throw new Error(describeError(result));
}

/**
 * Consumer-local lifecycle glue. It deliberately keeps WASM initialization,
 * root ownership, and application cleanup explicit instead of becoming a
 * framework-level singleton or scheduler.
 */
export async function mountApplication(
  createView: CreateView,
  cleanupApplicationResources?: () => void,
): Promise<{
  readonly runtime: ReactiveCore;
  readonly root: RendererRoot;
  readonly dispose: () => void;
}> {
  await initializeWasm();

  const runtimeResult = await createReactiveCore(() => wasm);
  if (!runtimeResult.ok) throwResultError(runtimeResult);
  const runtime = runtimeResult.value;

  const container = document.querySelector<HTMLElement>("#app");
  if (!container) {
    runtime.dispose();
    throw new Error("Expected an #app container.");
  }

  const rootResult = createRoot(container, runtime);
  if (!rootResult.ok) {
    runtime.dispose();
    throwResultError(rootResult);
  }
  const root = rootResult.value;
  let applicationResourcesCleaned = false;
  let disposed = false;

  const cleanupApplicationResourcesOnce = (): void => {
    if (applicationResourcesCleaned) return;
    cleanupApplicationResources?.();
    applicationResourcesCleaned = true;
  };

  const flush = (): void => {
    const result = root.flush();
    if (!result.ok) throwResultError(result);
  };

  try {
    const mountResult = root.mount(createView({ runtime, flush }));
    if (!mountResult.ok) throwResultError(mountResult);
  } catch (error) {
    const rootCleanup = root.dispose();
    try {
      cleanupApplicationResourcesOnce();
    } finally {
      runtime.dispose();
    }
    if (!rootCleanup.ok) {
      throw new Error(`${describeError(error)}; cleanup: ${describeError(rootCleanup)}`);
    }
    throw error;
  }

  const dispose = (): void => {
    if (disposed) return;
    const rootResult = root.dispose();
    if (!rootResult.ok) throwResultError(rootResult);
    cleanupApplicationResourcesOnce();
    const runtimeResult = runtime.dispose();
    if (!runtimeResult.ok) throwResultError(runtimeResult);
    disposed = true;
  };

  window.addEventListener(
    "pagehide",
    () => {
      try {
        dispose();
      } catch (error) {
        console.error("Ruseact cleanup failed", error);
      }
    },
    { once: true },
  );

  return { runtime, root, dispose };
}

export function reportApplicationError(error: unknown): void {
  const message = describeError(error);
  const status = document.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.textContent = `Application failed: ${message}`;
    status.dataset.state = "error";
  }
  console.error("Ruseact application failed", error);
}
