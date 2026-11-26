import type { CoreResult, ReactiveCore, SignalHandle, SupportedScalar } from "ruseact";
import type { ConditionalBranchEnvironment, RendererResult } from "ruseact-dom";

declare global {
  const ruseact: {
    bindText<T extends SupportedScalar, D extends SupportedScalar>(
      dependencies: readonly SignalHandle<D>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => CoreResult<T>,
    ): unknown;
    conditional(
      dependencies: readonly SignalHandle<boolean>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => RendererResult<boolean>,
      whenTrue: (environment: ConditionalBranchEnvironment) => unknown,
      whenFalse: (environment: ConditionalBranchEnvironment) => unknown,
    ): unknown;
  };

  namespace JSX {
    interface IntrinsicElements {
      [elementName: string]: Record<string, unknown>;
    }
  }
}

export {};
