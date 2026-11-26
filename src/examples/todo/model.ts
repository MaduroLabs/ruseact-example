import type { ReactiveCore, SignalHandle } from "ruseact";

export interface TodoRecord {
  readonly id: number;
  readonly title: string;
  readonly completed: boolean;
}

export type TodoFilter = "all" | "active" | "completed";

export interface TodoViewContext {
  readonly runtime: ReactiveCore;
  readonly flush: () => void;
  readonly revision: SignalHandle<number>;
  readonly filter: SignalHandle<string>;
  readonly totalCount: SignalHandle<number>;
  readonly activeCount: SignalHandle<number>;
  readonly completedCount: SignalHandle<number>;
  readonly visibleCount: SignalHandle<number>;
  readonly hasVisibleTodos: SignalHandle<boolean>;
  readonly editingTaskId: SignalHandle<number>;
  readonly getVisibleTodos: () => readonly TodoRecord[];
  readonly addTodo: (title: string, flush?: boolean) => boolean;
  readonly toggleTodo: (id: number, flush?: boolean) => boolean;
  readonly beginEdit: (id: number, flush?: boolean) => boolean;
  readonly saveEdit: (id: number, title: string, flush?: boolean) => boolean;
  readonly cancelEdit: (flush?: boolean) => void;
  readonly removeTodo: (id: number, flush?: boolean) => boolean;
  readonly setFilter: (filter: TodoFilter, flush?: boolean) => void;
  readonly reverseVisible: (flush?: boolean) => void;
  readonly clearCompleted: (flush?: boolean) => void;
  readonly onParentSetup: () => void;
  readonly onItemSetup: (id: number) => void;
  readonly onManagedEvent: () => void;
}
