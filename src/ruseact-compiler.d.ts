import type { CoreResult, ReactiveCore, SignalHandle, SupportedScalar } from "ruseact";
import type {
  ConditionalBranchEnvironment,
  KeyedItemDescriptor,
  KeyedItemEnvironment,
  RendererResult,
} from "ruseact-dom";

declare global {
  const ruseact: {
    bindText<T extends SupportedScalar, D extends SupportedScalar>(
      dependencies: readonly SignalHandle<D>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => CoreResult<T>,
    ): unknown;
    bindAttribute<D extends SupportedScalar>(
      dependencies: readonly SignalHandle<D>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => CoreResult<string>,
    ): unknown;
    bindProperty<D extends SupportedScalar>(
      dependencies: readonly SignalHandle<D>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => CoreResult<string | boolean>,
    ): unknown;
    conditional(
      dependencies: readonly SignalHandle<boolean>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => RendererResult<boolean>,
      whenTrue: (environment: ConditionalBranchEnvironment) => unknown,
      whenFalse: (environment: ConditionalBranchEnvironment) => unknown,
    ): unknown;
    keyed<D extends SupportedScalar>(
      dependencies: readonly SignalHandle<D>[],
      evaluate: (context: { readonly runtime: ReactiveCore }) => RendererResult<readonly KeyedItemDescriptor[]>,
      createItem: (environment: KeyedItemEnvironment) => unknown,
    ): unknown;
  };

  namespace JSX {
    interface IntrinsicElements {
      [elementName: string]: Record<string, unknown>;
    }
  }
}

export {};
