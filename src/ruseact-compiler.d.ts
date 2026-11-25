import type { CoreResult, ReactiveCore, SignalHandle, SupportedScalar } from "ruseact";

declare global {
  const ruseact: {
    bindText<T extends SupportedScalar>(
      dependencies: readonly SignalHandle<T>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => CoreResult<T>,
    ): unknown;
  };

  namespace JSX {
    interface IntrinsicElements {
      [elementName: string]: Record<string, unknown>;
    }
  }
}

export {};
