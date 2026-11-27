import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/todo/App.mjs";
import type { ReactiveCore, SignalHandle } from "ruseact";
import type { TodoFilter, TodoRecord, TodoViewContext } from "./examples/todo/model";

const initialTodos: readonly TodoRecord[] = [
  { id: 1, title: "Read the Ruseact docs", completed: false },
  { id: 2, title: "Build a keyed list", completed: true },
  { id: 3, title: "Ship the consumer example", completed: false },
];

let applicationRuntime: ReactiveCore | undefined;
let application: Awaited<ReturnType<typeof mountApplication>> | undefined;
let todos: readonly TodoRecord[] = initialTodos;
let nextTaskId = 4;
let revisionValue = 0;
let currentFilter: TodoFilter = "all";
let reversed = false;
let currentEditingTaskId = -1;
let ownedSignals: SignalHandle<number | string | boolean>[] = [];
let applicationSignalsDisposed = false;
let parentSetupCount = 0;
let itemSetupCount = 0;
let managedEventCount = 0;
let applicationContext: TodoViewContext | undefined;

const isTest = __RUSEACT_INSTRUMENTED__ && new URLSearchParams(window.location.search).has("test");

function fail(result: { readonly ok: false; readonly error: { readonly code: string } }): never {
  throw new Error(result.error.code);
}

function createOwnedSignal<T extends number | string | boolean>(runtime: ReactiveCore, initial: T): SignalHandle<T> {
  const result = runtime.createSignal(initial);
  if (!result.ok) fail(result);
  ownedSignals.push(result.value);
  return result.value;
}

function setSignal<T extends number | string | boolean>(runtime: ReactiveCore, signal: SignalHandle<T>, value: T): void {
  const result = runtime.set(signal, value);
  if (!result.ok) fail(result);
}

function deriveVisibleTodos(): readonly TodoRecord[] {
  return todos.filter((todo) => {
    if (currentFilter === "active") return !todo.completed;
    if (currentFilter === "completed") return todo.completed;
    return true;
  });
}

function deriveCounts(): { readonly total: number; readonly active: number; readonly completed: number } {
  const completed = todos.reduce((count, todo) => count + (todo.completed ? 1 : 0), 0);
  return { total: todos.length, active: todos.length - completed, completed };
}

function disposeApplicationSignals(): void {
  if (!applicationRuntime || applicationSignalsDisposed) return;
  for (const signal of [...ownedSignals].reverse()) {
    const result = applicationRuntime.disposeSignal(signal);
    if (!result.ok) fail(result);
  }
  ownedSignals = [];
  applicationSignalsDisposed = true;
}

void mountApplication(
  ({ runtime, flush }) => {
    applicationRuntime = runtime;
    const revision = createOwnedSignal(runtime, revisionValue);
    const filter = createOwnedSignal(runtime, currentFilter);
    const counts = deriveCounts();
    const totalCount = createOwnedSignal(runtime, counts.total);
    const activeCount = createOwnedSignal(runtime, counts.active);
    const completedCount = createOwnedSignal(runtime, counts.completed);
    const visibleCount = createOwnedSignal(runtime, deriveVisibleTodos().length);
    const hasVisibleTodos = createOwnedSignal(runtime, deriveVisibleTodos().length > 0);
    const editingTaskId = createOwnedSignal(runtime, currentEditingTaskId);

    const publish = (retainedItemFieldsMayChange: boolean, shouldFlush: boolean): void => {
      const nextCounts = deriveCounts();
      setSignal(runtime, filter, currentFilter);
      setSignal(runtime, totalCount, nextCounts.total);
      setSignal(runtime, activeCount, nextCounts.active);
      setSignal(runtime, completedCount, nextCounts.completed);
      const visibleTodos = deriveVisibleTodos();
      setSignal(runtime, visibleCount, visibleTodos.length);
      setSignal(runtime, hasVisibleTodos, visibleTodos.length > 0);
      setSignal(runtime, editingTaskId, currentEditingTaskId);
      revisionValue += 1;
      setSignal(runtime, revision, revisionValue);
      if (!shouldFlush) return;
      flush();
      if (retainedItemFieldsMayChange) flush();
    };

    const updateEditing = (id: number, shouldFlush: boolean): boolean => {
      currentEditingTaskId = id;
      setSignal(runtime, editingTaskId, currentEditingTaskId);
      if (shouldFlush) flush();
      return true;
    };

    const context: TodoViewContext = {
      runtime,
      flush,
      revision,
      filter,
      totalCount,
      activeCount,
      completedCount,
      visibleCount,
      hasVisibleTodos,
      editingTaskId,
      getVisibleTodos: deriveVisibleTodos,
      addTodo(title, shouldFlush = true) {
        const trimmed = title.trim();
        if (trimmed.length === 0) return false;
        todos = [...todos, { id: nextTaskId, title: trimmed, completed: false }];
        nextTaskId += 1;
        publish(false, shouldFlush);
        return true;
      },
      toggleTodo(id, shouldFlush = true) {
        const target = todos.find((todo) => todo.id === id);
        if (!target) return false;
        todos = todos.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo));
        publish(true, shouldFlush);
        return true;
      },
      beginEdit(id, shouldFlush = true) {
        if (!todos.some((todo) => todo.id === id)) return false;
        return updateEditing(id, shouldFlush);
      },
      saveEdit(id, title, shouldFlush = true) {
        const trimmed = title.trim();
        if (trimmed.length === 0 || !todos.some((todo) => todo.id === id)) return false;
        todos = todos.map((todo) => (todo.id === id ? { ...todo, title: trimmed } : todo));
        currentEditingTaskId = -1;
        publish(true, shouldFlush);
        return true;
      },
      cancelEdit(shouldFlush = true) {
        updateEditing(-1, shouldFlush);
      },
      removeTodo(id, shouldFlush = true) {
        if (!todos.some((todo) => todo.id === id)) return false;
        todos = todos.filter((todo) => todo.id !== id);
        if (currentEditingTaskId === id) currentEditingTaskId = -1;
        publish(false, shouldFlush);
        return true;
      },
      setFilter(nextFilter, shouldFlush = true) {
        currentFilter = nextFilter;
        publish(false, shouldFlush);
      },
      reverseVisible(shouldFlush = true) {
        todos = [...todos].reverse();
        reversed = !reversed;
        publish(false, shouldFlush);
      },
      clearCompleted(shouldFlush = true) {
        const completedIds = new Set(todos.filter((todo) => todo.completed).map((todo) => todo.id));
        if (completedIds.size === 0) return;
        todos = todos.filter((todo) => !completedIds.has(todo.id));
        if (completedIds.has(currentEditingTaskId)) currentEditingTaskId = -1;
        publish(false, shouldFlush);
      },
      onParentSetup: () => {
        parentSetupCount += 1;
      },
      onItemSetup: () => {
        itemSetupCount += 1;
      },
      onManagedEvent: () => {
        managedEventCount += 1;
      },
    };

    applicationContext = context;
    return createView(context);
  },
  disposeApplicationSignals,
)
  .then((mounted) => {
    application = mounted;
    if (!isTest) return;
    const globalWindow = window as Window & {
      __ruseactTodoTest?: {
        getSnapshot(): {
          readonly todos: readonly TodoRecord[];
          readonly visibleIds: readonly number[];
          readonly filter: TodoFilter;
          readonly reversed: boolean;
          readonly parentSetupCount: number;
          readonly itemSetupCount: number;
          readonly managedEventCount: number;
        };
        add(title: string): boolean;
        toggleWithoutFlush(id: number): boolean;
        flush(): void;
        beginEdit(id: number): boolean;
        saveEdit(id: number, title: string): boolean;
        cancelEdit(): void;
        remove(id: number): boolean;
        setFilter(filter: TodoFilter): void;
        reverse(): void;
        clearCompleted(): void;
        dispose(): void;
        isApplicationSignalsDisposed(): boolean;
      };
    };
    globalWindow.__ruseactTodoTest = {
      getSnapshot() {
        return {
          todos,
          visibleIds: deriveVisibleTodos().map((todo) => todo.id),
          filter: currentFilter,
          reversed,
          parentSetupCount,
          itemSetupCount,
          managedEventCount,
        };
      },
      add(title) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        return applicationContext.addTodo(title);
      },
      toggleWithoutFlush(id) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        return applicationContext.toggleTodo(id, false);
      },
      flush() {
        const result = application?.root.flush();
        if (!result?.ok) throw new Error(JSON.stringify(result?.error ?? { code: "todo_flush_failed" }));
      },
      beginEdit(id) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        return applicationContext.beginEdit(id);
      },
      saveEdit(id, title) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        return applicationContext.saveEdit(id, title);
      },
      cancelEdit() {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        applicationContext.cancelEdit();
      },
      remove(id) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        return applicationContext.removeTodo(id);
      },
      setFilter(filter) {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        applicationContext.setFilter(filter);
      },
      reverse() {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        applicationContext.reverseVisible();
      },
      clearCompleted() {
        if (!applicationContext) throw new Error("Todo application is not mounted.");
        applicationContext.clearCompleted();
      },
      dispose() {
        application?.dispose();
      },
      isApplicationSignalsDisposed() {
        return applicationSignalsDisposed;
      },
    };
  })
  .catch(reportApplicationError);
