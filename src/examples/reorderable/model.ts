import type { ReactiveCore, SignalHandle } from "ruseact";

export interface ReorderableItem {
  readonly id: number;
  readonly title: string;
}

export interface ReorderableViewContext {
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
  readonly revision: SignalHandle<number>;
  readonly metricsTick: SignalHandle<number>;
  readonly hasItems: SignalHandle<boolean>;
  readonly expandedItemId: SignalHandle<number>;
  readonly getItems: () => readonly ReorderableItem[];
  readonly append: (title: string, shouldFlush?: boolean) => boolean;
  readonly prepend: (title: string, shouldFlush?: boolean) => boolean;
  readonly moveUp: (id: number, shouldFlush?: boolean) => boolean;
  readonly moveDown: (id: number, shouldFlush?: boolean) => boolean;
  readonly moveFirst: (id: number, shouldFlush?: boolean) => boolean;
  readonly moveLast: (id: number, shouldFlush?: boolean) => boolean;
  readonly reverse: (shouldFlush?: boolean) => boolean;
  readonly shuffle: (shouldFlush?: boolean) => boolean;
  readonly sortByTitle: (shouldFlush?: boolean) => boolean;
  readonly updateTitle: (id: number, shouldFlush?: boolean) => boolean;
  readonly remove: (id: number, shouldFlush?: boolean) => boolean;
  readonly clear: (shouldFlush?: boolean) => boolean;
  readonly restoreDemo: (shouldFlush?: boolean) => boolean;
  readonly toggleExpanded: (id: number, shouldFlush?: boolean) => boolean;
  readonly onParentSetup: () => void;
  readonly onItemSetup: (id: number) => void;
  readonly onManagedEvent: () => void;
  readonly onDetailEvent: () => void;
  readonly getParentSetupCount: () => number;
  readonly getItemSetupCount: () => number;
  readonly getReorderActionCount: () => number;
  readonly getFlushCount: () => number;
  readonly getDetailEventCount: () => number;
}
