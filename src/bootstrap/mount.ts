import initializeWasm, * as wasm from "ruseact/wasm/web";
import { createReactiveCore, type ReactiveCore } from "ruseact";
import { createRoot, type RendererRoot, type ViewDescription } from "ruseact-dom";

export interface ApplicationViewContext {
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
}

type CreateView = (context: ApplicationViewContext) => ViewDescription;

export class ApplicationOperationError extends Error {
  readonly diagnostic: unknown;

  constructor(diagnostic: unknown) {
    super(describeError(diagnostic));
    this.name = "ApplicationOperationError";
    this.diagnostic = diagnostic;
  }
}

export class ApplicationLifecycleError extends Error {
  readonly originalError: unknown;
  readonly cleanupError: unknown;

  constructor(message: string, originalError: unknown, cleanupError: unknown) {
    super(message);
    this.name = "ApplicationLifecycleError";
    this.originalError = originalError;
    this.cleanupError = cleanupError;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApplicationOperationError) return describeError(error.diagnostic);
  if (error instanceof ApplicationLifecycleError) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) {
    const detail = error as {
      code: unknown;
      operation?: unknown;
      message?: unknown;
      causeCode?: unknown;
      causeOperation?: unknown;
    };
    const cause = detail.causeCode ? `; cause ${String(detail.causeCode)}${detail.causeOperation ? ` (${String(detail.causeOperation)})` : ""}` : "";
    return `${String(detail.code)}${detail.operation ? ` (${String(detail.operation)})` : ""}${detail.message ? `: ${String(detail.message)}` : ""}${cause}`;
  }
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
  throw new ApplicationOperationError(result.error);
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
    const originalError = new Error("Expected an #app container.");
    const cleanupResult = runtime.dispose();
    if (!cleanupResult.ok) {
      throw new ApplicationLifecycleError(
        "Application initialization failed and runtime cleanup failed.",
        originalError,
        new ApplicationOperationError(cleanupResult.error),
      );
    }
    throw originalError;
  }

  const rootResult = createRoot(container, runtime);
  if (!rootResult.ok) {
    const originalError = new ApplicationOperationError(rootResult.error);
    const cleanupResult = runtime.dispose();
    if (!cleanupResult.ok) {
      throw new ApplicationLifecycleError(
        "Renderer root initialization failed and runtime cleanup failed.",
        originalError,
        new ApplicationOperationError(cleanupResult.error),
      );
    }
    throw originalError;
  }

  const root = rootResult.value;
  let applicationResourcesCleaned = false;
  let rootDisposed = false;
  let runtimeDisposed = false;
  let disposalInProgress = false;
  let onPageHide: (event: PageTransitionEvent) => void = () => undefined;

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
    let cleanupError: unknown;
    try {
      const rootCleanup = root.dispose();
      if (!rootCleanup.ok) throwResultError(rootCleanup);
      rootDisposed = true;
      cleanupApplicationResourcesOnce();
    } catch (failure) {
      cleanupError = failure;
    }

    if (cleanupError !== undefined) {
      throw new ApplicationLifecycleError(
        "Application mount failed and renderer/application cleanup failed.",
        error,
        cleanupError,
      );
    }

    const runtimeCleanup = runtime.dispose();
    if (!runtimeCleanup.ok) {
      throw new ApplicationLifecycleError(
        "Application mount failed and runtime cleanup failed.",
        error,
        new ApplicationOperationError(runtimeCleanup.error),
      );
    }
    runtimeDisposed = true;
    throw error;
  }

  const dispose = (): void => {
    if (runtimeDisposed) return;
    if (disposalInProgress) {
      throw new ApplicationLifecycleError(
        "Application disposal was re-entered.",
        undefined,
        new Error("dispose is already in progress"),
      );
    }

    disposalInProgress = true;
    try {
      if (!rootDisposed) {
        const rootResult = root.dispose();
        if (!rootResult.ok) {
          throw new ApplicationLifecycleError(
            "Renderer cleanup failed; application-owned resources were retained.",
            undefined,
            new ApplicationOperationError(rootResult.error),
          );
        }
        rootDisposed = true;
      }

      try {
        cleanupApplicationResourcesOnce();
      } catch (error) {
        throw new ApplicationLifecycleError(
          "Application-owned resource cleanup failed; the runtime was retained.",
          undefined,
          error,
        );
      }

      const runtimeResult = runtime.dispose();
      if (!runtimeResult.ok) {
        throw new ApplicationLifecycleError(
          "Runtime cleanup failed after renderer and application cleanup.",
          undefined,
          new ApplicationOperationError(runtimeResult.error),
        );
      }
      runtimeDisposed = true;
      window.removeEventListener("pagehide", onPageHide);
    } finally {
      disposalInProgress = false;
    }
  };

  onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    try {
      dispose();
    } catch (error) {
      console.error("Ruseact cleanup failed", error);
    }
  };

  window.addEventListener("pagehide", onPageHide);

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
